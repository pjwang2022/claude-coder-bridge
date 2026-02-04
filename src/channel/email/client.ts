import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import * as fs from 'fs';
import * as path from 'path';
import type { EmailConfig, EmailContext } from './types.js';
import type { EmailClaudeManager } from './manager.js';
import type { EmailPermissionManager } from './permission-manager.js';
import { DatabaseManager } from '../../db/database.js';
import { validateFile } from '../../shared/file-validator.js';
import { saveAttachment, buildAttachmentPrompt } from '../../shared/attachments.js';
import { transcribeAudio } from '../../shared/speechmatics.js';
import {
  buildResultEmail,
  buildProcessingEmail,
  buildStatusEmail,
  buildErrorEmail,
  buildHelpEmail,
} from './messages.js';

export class EmailBot {
  private imap: ImapFlow;
  public transporter: nodemailer.Transporter;
  private db: DatabaseManager;
  private allowedSenders: string[];
  private botEmail: string;
  private running = false;

  constructor(
    private config: EmailConfig,
    private claudeManager: EmailClaudeManager,
    private permissionManager: EmailPermissionManager,
    private baseFolder: string,
  ) {
    this.botEmail = config.emailUser;
    this.allowedSenders = config.allowedSenders;
    this.db = new DatabaseManager();

    this.imap = this.createImapClient();

    this.transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.emailUser,
        pass: config.emailPass,
      },
    });
  }

  private createImapClient(): ImapFlow {
    const client = new ImapFlow({
      host: this.config.imapHost,
      port: this.config.imapPort,
      secure: true,
      auth: {
        user: this.config.emailUser,
        pass: this.config.emailPass,
      },
      logger: false,
      // Restart IDLE every 2 min to prevent NAT/firewall/server timeouts
      maxIdleTime: 2 * 60 * 1000,
    });

    client.on('error', (err: Error) => {
      console.error('Email bot: IMAP error event:', err.message);
    });

    return client;
  }

  async start(): Promise<void> {
    this.running = true;

    await this.imap.connect();
    console.log('Email bot: IMAP connected.');

    // Start listening loop
    this.listenLoop().catch(err => {
      console.error('Email bot: Listen loop error:', err);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    try {
      await this.imap.logout();
    } catch {
      // ignore logout errors
    }
    this.transporter.close();
  }

  private async ensureConnected(): Promise<boolean> {
    if (this.imap.usable) return true;

    console.log('Email bot: Reconnecting IMAP...');
    this.imap = this.createImapClient();
    try {
      await this.imap.connect();
      console.log('Email bot: IMAP reconnected.');
      return true;
    } catch (err) {
      console.error('Email bot: Reconnect failed:', (err as Error).message);
      return false;
    }
  }

  private async listenLoop(): Promise<void> {
    const POLL_INTERVAL = 30_000; // Poll every 30s as IDLE fallback
    const RECONNECT_DELAY = 5_000;

    while (this.running) {
      // Step 1: Ensure connection
      if (!await this.ensureConnected()) {
        await this.sleep(RECONNECT_DELAY);
        continue;
      }

      let lock;
      try {
        lock = await this.imap.getMailboxLock('INBOX');
      } catch (err) {
        console.error('Email bot: Failed to lock INBOX:', (err as Error).message);
        await this.sleep(RECONNECT_DELAY);
        continue;
      }

      try {
        // Step 2: Process existing unseen messages
        await this.processUnseenMessages();

        // Step 3: IDLE loop with polling fallback
        console.log('Email bot: Entering IDLE mode, waiting for new messages...');
        while (this.running && this.imap.usable) {
          try {
            // Race IDLE against a timeout — ensures we poll even if IDLE doesn't fire
            await Promise.race([
              this.imap.idle(),
              this.sleep(POLL_INTERVAL),
            ]);
          } catch (err) {
            if (!this.running) break;
            console.error('Email bot: IDLE error:', (err as Error).message);
            break;
          }

          // Check connection health before processing
          if (!this.imap.usable) {
            console.log('Email bot: Connection lost, will reconnect...');
            break;
          }

          await this.processUnseenMessages();

          // Check again after processing (connection may have dropped mid-fetch)
          if (!this.imap.usable) {
            console.log('Email bot: Connection lost during message processing, will reconnect...');
            break;
          }
        }
      } catch (err) {
        if (!this.running) break;
        console.error('Email bot: Listen loop error:', (err as Error).message);
      } finally {
        try { lock?.release(); } catch { /* ignore */ }
      }

      if (this.running) {
        await this.sleep(RECONNECT_DELAY);
      }
    }
  }

  private async processUnseenMessages(): Promise<void> {
    const IMAP_OP_TIMEOUT = 15_000;

    try {
      console.log('Email bot: Checking for unseen messages...');

      // Collect messages first with a timeout to avoid hanging on dead connections
      const collected: Array<{ uid: number; source: Buffer | undefined; envelope: any }> = [];
      const messages = this.imap.fetch({ seen: false }, {
        envelope: true,
        source: true,
        uid: true,
      });

      try {
        await this.withTimeout(
          (async () => {
            for await (const msg of messages) {
              collected.push({ uid: msg.uid, source: msg.source, envelope: msg.envelope });
            }
          })(),
          IMAP_OP_TIMEOUT,
          'IMAP fetch',
        );
      } catch (err) {
        console.error('Email bot: Error fetching messages:', (err as Error).message);
        // Process whatever we collected before the error
      }

      console.log(`Email bot: Found ${collected.length} unseen message(s)`);

      for (const msg of collected) {
        console.log(`Email bot: Processing UID=${msg.uid}, subject="${msg.envelope?.subject}"`);
        try {
          // Mark as seen with timeout
          await this.withTimeout(
            this.imap.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true }),
            IMAP_OP_TIMEOUT,
            'messageFlagsAdd',
          );

          if (!msg.source) {
            console.log('Email bot: Message has no source, skipping');
            continue;
          }
          const parsed = await simpleParser(msg.source);
          await this.handleEmail(parsed);
        } catch (error) {
          console.error('Email bot: Error processing message:', (error as Error).message);
        }
      }
      console.log(`Email bot: Processed ${collected.length} message(s)`);
    } catch (error) {
      console.error('Email bot: Error in processUnseenMessages:', error);
    }
  }

  private async handleEmail(parsed: any): Promise<void> {
    const from = parsed.from?.value?.[0]?.address?.toLowerCase();
    console.log(`Email bot: handleEmail — from=${from}, subject="${parsed.subject}", botEmail=${this.botEmail}`);

    if (!from) {
      console.log('Email bot: No sender address found, skipping');
      return;
    }

    // Skip our own emails
    if (from === this.botEmail.toLowerCase()) {
      console.log('Email bot: Skipping own email');
      return;
    }

    // Auth check
    if (this.allowedSenders.length > 0 && !this.allowedSenders.includes(from)) {
      console.log(`Email bot: Unauthorized sender: ${from} (allowed: ${this.allowedSenders.join(', ')})`);
      return;
    }

    console.log(`Email bot: Processing email from ${from}`);
    const subject = parsed.subject || '';
    const messageId = parsed.messageId || '';
    const body = (parsed.text || '').trim();

    // Parse [project-name] from subject
    const projectMatch = subject.match(/\[([^\]]+)\]/);

    // Handle commands
    if (body.startsWith('/help')) {
      await this.sendReply(from, messageId, buildHelpEmail());
      return;
    }

    if (!projectMatch) {
      await this.sendReply(from, messageId, {
        subject: 'Missing project tag',
        text: 'Please include [project-name] in the subject line.\nExample: [my-app] Fix the login bug\n\nSend /help for more info.',
      });
      return;
    }

    const projectName = projectMatch[1];
    const projectDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(projectDir)) {
      await this.sendReply(from, messageId, {
        subject: `Project not found: ${projectName}`,
        text: `Project "${projectName}" does not exist in the base folder.`,
      });
      return;
    }

    if (body.startsWith('/result')) {
      await this.handleResultCommand(from, messageId);
      return;
    }

    if (body.startsWith('/status')) {
      await this.handleStatusCommand(from, messageId);
      return;
    }

    if (body.startsWith('/cancel')) {
      if (!this.claudeManager.hasActiveProcess(from, projectName)) {
        await this.sendReply(from, messageId, {
          subject: `No active task: ${projectName}`,
          text: 'No active task to cancel.',
        });
        return;
      }
      this.claudeManager.cancelTask(from, projectName);
      await this.sendReply(from, messageId, {
        subject: `Task cancelled: ${projectName}`,
        text: `Task cancelled for project: ${projectName}. Session is preserved.`,
      });
      return;
    }

    if (body.startsWith('/clear')) {
      this.claudeManager.clearSession(from, projectName);
      await this.sendReply(from, messageId, {
        subject: `Session cleared: ${projectName}`,
        text: `Session cleared for project: ${projectName}`,
      });
      return;
    }

    // Extract prompt: remove [project-name] from subject, combine with body
    const subjectPrompt = subject.replace(/^(Re:\s*)+/i, '').replace(/\[[^\]]+\]\s*/, '').trim();
    let prompt = body || subjectPrompt;
    if (!prompt) {
      await this.sendReply(from, messageId, {
        subject: 'Empty prompt',
        text: 'Please include a prompt in the email body or subject line.',
      });
      return;
    }

    // Handle attachments with validation
    const attachments = parsed.attachments || [];
    const rejected: string[] = [];
    const validAttachments: any[] = [];
    for (const att of attachments) {
      const result = validateFile(att.filename || 'unknown', att.size || 0);
      if (!result.allowed) {
        rejected.push(`${att.filename}: ${result.reason}`);
      } else {
        validAttachments.push({ ...att, _category: result.category });
      }
    }

    // Handle audio attachments for voice transcription
    const audioAttachments = validAttachments.filter((a: any) => a._category === 'audio');
    if (audioAttachments.length > 0) {
      const speechmaticsApiKey = process.env.SPEECHMATICS_API_KEY;
      if (speechmaticsApiKey) {
        const audio = audioAttachments[0];
        const language = process.env.SPEECHMATICS_LANGUAGE || 'cmn';
        try {
          const transcribedText = await transcribeAudio(
            speechmaticsApiKey,
            audio.content,
            audio.filename || 'audio.ogg',
            language,
          );
          if (transcribedText.trim()) {
            prompt = transcribedText + (prompt ? `\n\n(Original email body: ${prompt})` : '');
          }
        } catch (error) {
          console.error('Email bot: Audio transcription error:', error);
        }
      }
    }

    // Handle image and text attachments
    const fileAttachments = validAttachments.filter((a: any) => a._category === 'image' || a._category === 'text');
    if (fileAttachments.length > 0) {
      const workingDir = path.join(this.baseFolder, projectName);
      const attachmentPaths: string[] = [];
      for (const att of fileAttachments) {
        try {
          attachmentPaths.push(saveAttachment(workingDir, att.filename || 'image.jpg', att.content));
          console.log(`Email bot: Saved attachment: ${att.filename}`);
        } catch (error) {
          console.error(`Email bot: Error saving attachment ${att.filename}:`, error);
        }
      }

      if (attachmentPaths.length > 0) {
        prompt += buildAttachmentPrompt(attachmentPaths);
      }
    }

    // Check for active process
    if (this.claudeManager.hasActiveProcess(from, projectName)) {
      await this.sendReply(from, messageId, {
        subject: `Task already running: ${projectName}`,
        text: 'A task is already running for this project. Send /status to check.',
      });
      return;
    }

    // Send processing confirmation
    await this.sendReply(from, messageId, buildProcessingEmail());

    // Start Claude task
    try {
      const taskId = await this.claudeManager.runTask(from, projectName, prompt, messageId);
      console.log(`Email bot: Task ${taskId} started for ${from} in ${projectName}`);
    } catch (error) {
      console.error('Email bot: Claude task error:', error);
      await this.sendReply(from, messageId, buildErrorEmail(
        error instanceof Error ? error.message : String(error),
      ));
    }
  }

  private async handleResultCommand(from: string, messageId: string): Promise<void> {
    const task = this.db.getLatestEmailTask(from);

    if (!task) {
      await this.sendReply(from, messageId, { subject: 'No tasks', text: 'No tasks found.' });
      return;
    }

    if (task.status === 'running') {
      const elapsed = Math.round((Date.now() - task.createdAt) / 1000);
      await this.sendReply(from, messageId, {
        subject: 'Task still running',
        text: `Task is still running (${elapsed}s elapsed). Try again later.`,
      });
      return;
    }

    const msg = buildResultEmail(task);
    await this.sendReply(from, messageId, msg);
  }

  private async handleStatusCommand(from: string, messageId: string): Promise<void> {
    const running = this.db.getRunningEmailTasks(from);
    await this.sendReply(from, messageId, buildStatusEmail(running));
  }

  private async sendReply(
    to: string,
    inReplyTo: string,
    msg: { subject: string; text?: string; html?: string },
  ): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: this.botEmail,
        to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        ...(inReplyTo ? { inReplyTo, references: inReplyTo } : {}),
      });
    } catch (error) {
      console.error('Email bot: Failed to send reply:', error);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      promise.then(
        (val) => { clearTimeout(timer); resolve(val); },
        (err) => { clearTimeout(timer); reject(err); },
      );
    });
  }
}
