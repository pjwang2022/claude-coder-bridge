import * as crypto from 'crypto';
import * as path from 'path';
import type { Request, Response } from 'express';
import type { LineWebhookBody, LineWebhookEvent } from './types.js';
import type { LINEClaudeManager } from './manager.js';
import type { LinePermissionManager } from './permission-manager.js';
import { DatabaseManager } from '../../db/database.js';
import { transcribeAudio } from '../../shared/speechmatics.js';
import { saveAttachment, buildAttachmentPrompt } from '../../shared/attachments.js';
import { validateFile } from '../../shared/file-validator.js';
import {
  buildResultFlexMessage,
  buildProjectListFlexMessage,
  buildProcessingReply,
  buildStatusReply,
  buildErrorReply,
  buildHelpReply,
} from './messages.js';

export class LineBotHandler {
  private db: DatabaseManager;

  constructor(
    private channelSecret: string,
    private channelAccessToken: string,
    private allowedUserIds: string[],
    private claudeManager: LINEClaudeManager,
    private permissionManager: LinePermissionManager,
    private baseFolder: string,
    private speechmaticsApiKey: string,
    private speechmaticsLanguage: string,
  ) {
    this.db = new DatabaseManager();
  }

  async handleWebhook(req: Request, res: Response): Promise<void> {
    // Validate signature
    const signature = req.headers['x-line-signature'] as string;
    const rawBody = JSON.stringify(req.body);
    const expectedSignature = crypto
      .createHmac('SHA256', this.channelSecret)
      .update(rawBody)
      .digest('base64');

    if (signature !== expectedSignature) {
      console.error('LINE webhook: Invalid signature');
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    // Respond 200 immediately (LINE requires quick response)
    res.status(200).json({ status: 'ok' });

    const body: LineWebhookBody = req.body;
    for (const event of body.events) {
      try {
        await this.handleEvent(event);
      } catch (error) {
        console.error('LINE event handling error:', error);
      }
    }
  }

  private async handleEvent(event: LineWebhookEvent): Promise<void> {
    // Auto-leave groups and rooms
    if (event.source.type === 'group' || event.source.type === 'room') {
      if (event.type === 'join') {
        await this.replyText(event.replyToken, 'This bot only works in direct messages.');
      }
      await this.leaveGroupOrRoom(event.source);
      return;
    }

    const userId = event.source.userId;

    // Auth check
    if (this.allowedUserIds.length > 0 && !this.allowedUserIds.includes(userId)) {
      if (event.type === 'message') {
        await this.replyText(event.replyToken, 'Unauthorized.');
      }
      return;
    }

    switch (event.type) {
      case 'message':
        if (event.message?.type === 'text' && event.message.text) {
          await this.handleTextMessage(event, userId);
        } else if (event.message?.type === 'audio') {
          await this.handleAudioMessage(event, userId);
        } else if (event.message?.type === 'image') {
          await this.handleImageMessage(event, userId);
        }
        break;
      case 'postback':
        if (event.postback?.data) {
          this.permissionManager.handlePostback(userId, event.postback.data);
        }
        break;
    }
  }

  private async handleTextMessage(event: LineWebhookEvent, userId: string): Promise<void> {
    const text = event.message!.text!.trim();

    if (text.startsWith('/project')) {
      await this.handleProjectCommand(event, userId, text);
    } else if (text === '/result') {
      await this.handleResultCommand(event, userId);
    } else if (text === '/status') {
      await this.handleStatusCommand(event, userId);
    } else if (text === '/clear') {
      await this.handleClearCommand(event, userId);
    } else if (text === '/help') {
      await this.replyMessage(event.replyToken, [buildHelpReply()]);
    } else {
      await this.handleClaudeRequest(event, userId, text);
    }
  }

  private async handleProjectCommand(
    event: LineWebhookEvent,
    userId: string,
    text: string
  ): Promise<void> {
    const parts = text.split(/\s+/);
    const subcommand = parts[1];

    // /project or /project list
    if (!subcommand || subcommand === 'list') {
      let projects: string[] = [];
      try {
        projects = fs.readdirSync(this.baseFolder, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      } catch {
        await this.replyText(event.replyToken, 'Could not read project directory.');
        return;
      }
      const currentProject = this.db.getLineUserProject(userId);
      await this.replyMessage(event.replyToken, [
        buildProjectListFlexMessage(projects, currentProject),
      ]);
      return;
    }

    // /project <name>
    const projectName = subcommand;
    const projectDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(projectDir)) {
      await this.replyText(event.replyToken, `Project "${projectName}" not found. Use /project list to see available projects.`);
      return;
    }

    this.db.setLineUserProject(userId, projectName);
    await this.replyText(event.replyToken, `Project set to: ${projectName}`);
  }

  private async handleResultCommand(event: LineWebhookEvent, userId: string): Promise<void> {
    const task = this.db.getLatestLineTask(userId);

    if (!task) {
      await this.replyText(event.replyToken, 'No tasks found.');
      return;
    }

    if (task.status === 'running') {
      const elapsed = Math.round((Date.now() - task.createdAt) / 1000);
      await this.replyText(event.replyToken, `Task is still running (${elapsed}s elapsed). Try again later.`);
      return;
    }

    await this.replyMessage(event.replyToken, [buildResultFlexMessage(task)]);
  }

  private async handleStatusCommand(event: LineWebhookEvent, userId: string): Promise<void> {
    const running = this.db.getRunningLineTasks(userId);
    await this.replyMessage(event.replyToken, [buildStatusReply(running)]);
  }

  private async handleClearCommand(event: LineWebhookEvent, userId: string): Promise<void> {
    const projectName = this.db.getLineUserProject(userId);
    if (!projectName) {
      await this.replyText(event.replyToken, 'No project selected. Use /project <name> first.');
      return;
    }

    this.claudeManager.clearSession(userId, projectName);
    await this.replyText(event.replyToken, `Session cleared for project: ${projectName}`);
  }

  private async handleClaudeRequest(
    event: LineWebhookEvent,
    userId: string,
    prompt: string
  ): Promise<void> {
    const projectName = this.db.getLineUserProject(userId);

    if (!projectName) {
      await this.replyText(
        event.replyToken,
        'No project selected.\nUse /project <name> to set one.\nUse /project list to see available projects.'
      );
      return;
    }

    if (this.claudeManager.hasActiveProcess(userId, projectName)) {
      await this.replyText(
        event.replyToken,
        'A task is already running for this project. Use /status to check.'
      );
      return;
    }

    // Check quota to decide reply text
    const hasQuota = await this.checkPushQuota();
    await this.replyMessage(event.replyToken, [buildProcessingReply(hasQuota)]);

    // Spawn Claude Code asynchronously
    try {
      const taskId = await this.claudeManager.runTask(userId, projectName, prompt);
      console.log(`LINE: Task ${taskId} started for ${userId} in ${projectName}`);
    } catch (error) {
      console.error('LINE: Claude task error:', error);
      // Can't reply (token used), push error if possible
      try {
        await this.pushText(userId, `Error starting task: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // Nothing we can do
      }
    }
  }

  private async handleAudioMessage(event: LineWebhookEvent, userId: string): Promise<void> {
    if (!this.speechmaticsApiKey) {
      await this.replyText(event.replyToken, 'Voice messages are not supported. Please send text.');
      return;
    }

    const messageId = event.message!.id;
    await this.replyText(event.replyToken, '🎙️ Transcribing audio...');

    try {
      const audioBuffer = await this.downloadLineContent(messageId);

      const validation = validateFile('audio.m4a', audioBuffer.length);
      if (!validation.allowed) {
        await this.pushText(userId, `File rejected: ${validation.reason}`);
        return;
      }

      const transcribedText = await transcribeAudio(
        this.speechmaticsApiKey,
        audioBuffer,
        'audio.m4a',
        this.speechmaticsLanguage,
      );

      if (!transcribedText.trim()) {
        await this.pushText(userId, 'Could not transcribe audio (empty result).');
        return;
      }

      await this.pushText(userId, `📝 "${transcribedText}"`);
      await this.handleClaudeRequestFromTranscription(userId, transcribedText);
    } catch (error) {
      console.error('LINE audio transcription error:', error);
      try {
        await this.pushText(
          userId,
          `Transcription error: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch {
        // Nothing we can do
      }
    }
  }

  private async handleClaudeRequestFromTranscription(userId: string, prompt: string): Promise<void> {
    const projectName = this.db.getLineUserProject(userId);

    if (!projectName) {
      await this.pushText(userId, 'No project selected.\nUse /project <name> to set one.\nUse /project list to see available projects.');
      return;
    }

    if (this.claudeManager.hasActiveProcess(userId, projectName)) {
      await this.pushText(userId, 'A task is already running for this project. Use /status to check.');
      return;
    }

    try {
      const taskId = await this.claudeManager.runTask(userId, projectName, prompt);
      console.log(`LINE: Task ${taskId} started for ${userId} in ${projectName} (from audio)`);
    } catch (error) {
      console.error('LINE: Claude task error (from audio):', error);
      try {
        await this.pushText(userId, `Error starting task: ${error instanceof Error ? error.message : String(error)}`);
      } catch {
        // Nothing we can do
      }
    }
  }

  private async downloadLineContent(messageId: string): Promise<Buffer> {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
      },
    );

    if (!response.ok) {
      throw new Error(`LINE Content API error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async handleImageMessage(event: LineWebhookEvent, userId: string): Promise<void> {
    const projectName = this.db.getLineUserProject(userId);

    if (!projectName) {
      await this.replyText(
        event.replyToken,
        'No project selected.\nUse /project <name> to set one.\nUse /project list to see available projects.',
      );
      return;
    }

    const messageId = event.message!.id;
    await this.replyText(event.replyToken, '🖼️ Image received, processing...');

    try {
      const imageBuffer = await this.downloadLineContent(messageId);

      const validation = validateFile(`${messageId}.jpg`, imageBuffer.length);
      if (!validation.allowed) {
        await this.pushText(userId, `File rejected: ${validation.reason}`);
        return;
      }

      const workingDir = path.join(this.baseFolder, projectName);
      const savedPath = saveAttachment(workingDir, `${messageId}.jpg`, imageBuffer);

      console.log(`LINE: Saved image to ${savedPath}`);

      const prompt = `[User sent an image]${buildAttachmentPrompt([savedPath])}`;
      await this.handleClaudeRequestFromTranscription(userId, prompt);
    } catch (error) {
      console.error('LINE image handling error:', error);
      try {
        await this.pushText(
          userId,
          `Image processing error: ${error instanceof Error ? error.message : String(error)}`,
        );
      } catch {
        // Nothing we can do
      }
    }
  }

  // --- LINE API Helpers ---

  private async replyText(replyToken: string, text: string): Promise<void> {
    await this.replyMessage(replyToken, [{ type: 'text', text: text.substring(0, 5000) }]);
  }

  private async replyMessage(replyToken: string, messages: object[]): Promise<void> {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify({ replyToken, messages }),
    });

    if (!response.ok) {
      console.error('LINE reply error:', response.status, await response.text());
    }
  }

  private async pushText(userId: string, text: string): Promise<void> {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [{ type: 'text', text: text.substring(0, 5000) }],
      }),
    });
  }

  private async leaveGroupOrRoom(source: LineWebhookEvent['source']): Promise<void> {
    try {
      if (source.groupId) {
        await fetch(`https://api.line.me/v2/bot/group/${source.groupId}/leave`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
        });
      } else if (source.roomId) {
        await fetch(`https://api.line.me/v2/bot/room/${source.roomId}/leave`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
        });
      }
    } catch (error) {
      console.error('LINE: Failed to leave group/room:', error);
    }
  }

  private async checkPushQuota(): Promise<boolean> {
    try {
      const [quotaResp, consumptionResp] = await Promise.all([
        fetch('https://api.line.me/v2/bot/message/quota', {
          headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
        }),
        fetch('https://api.line.me/v2/bot/message/quota/consumption', {
          headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
        }),
      ]);

      if (!quotaResp.ok || !consumptionResp.ok) return false;

      const quota = await quotaResp.json() as { value: number };
      const consumption = await consumptionResp.json() as { totalUsage: number };
      return (quota.value - consumption.totalUsage) > 0;
    } catch {
      return false;
    }
  }
}
