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

    this.imap = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: true,
      auth: {
        user: config.emailUser,
        pass: config.emailPass,
      },
      logger: false,
    });

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

  async start(): Promise<void> {
    this.running = true;

    // Prevent unhandled 'error' events from crashing the process
    this.imap.on('error', (err: Error) => {
      console.error('Email bot: IMAP error event:', err.message);
    });

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

  private async listenLoop(): Promise<void> {
    while (this.running) {
      let lock;
      try {
        // Ensure connected
        if (!this.imap.usable) {
          console.log('Email bot: Reconnecting IMAP...');
          try { await this.imap.connect(); } catch (err) {
            console.error('Email bot: Reconnect failed:', (err as Error).message);
            await this.sleep(10000);
            continue;
          }
          console.log('Email bot: IMAP reconnected.');
        }

        lock = await this.imap.getMailboxLock('INBOX');

        // Process any existing unseen messages first
        await this.processUnseenMessages();

        // IDLE loop: wait for new messages
        while (this.running) {
          try {
            await this.imap.idle();
          } catch (err) {
            if (!this.running) break;
            console.error('Email bot: IDLE error:', (err as Error).message);
            break; // break inner loop to reconnect
          }

          await this.processUnseenMessages();
        }
      } catch (err) {
        if (!this.running) break;
        console.error('Email bot: Listen loop error, will retry:', (err as Error).message);
      } finally {
        try { lock?.release(); } catch { /* ignore */ }
      }

      if (this.running) {
        console.log('Email bot: Waiting 10s before reconnect...');
        await this.sleep(10000);
      }
    }
  }

  private async processUnseenMessages(): Promise<void> {
    try {
      const messages = this.imap.fetch({ seen: false }, {
        envelope: true,
        source: true,
        uid: true,
      });

      for await (const msg of messages) {
        try {
          // Mark as seen immediately
          await this.imap.messageFlagsAdd({ uid: msg.uid }, ['\\Seen'], { uid: true });

          if (!msg.source) continue;
          const parsed = await simpleParser(msg.source);
          await this.handleEmail(parsed);
        } catch (error) {
          console.error('Email bot: Error processing message:', error);
        }
      }
    } catch (error) {
      console.error('Email bot: Error fetching unseen messages:', error);
    }
  }

  private async handleEmail(parsed: any): Promise<void> {
    const from = parsed.from?.value?.[0]?.address?.toLowerCase();
    if (!from) return;

    // Skip our own emails
    if (from === this.botEmail.toLowerCase()) return;

    // Auth check
    if (this.allowedSenders.length > 0 && !this.allowedSenders.includes(from)) {
      console.log(`Email bot: Unauthorized sender: ${from}`);
      return;
    }

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
}
