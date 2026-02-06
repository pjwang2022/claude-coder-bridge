import * as path from 'path';
import * as fs from 'fs';
import { App } from '@slack/bolt';
import type { SlackConfig } from './types.js';
import type { SlackClaudeManager } from './manager.js';
import type { SlackPermissionManager } from './permission-manager.js';
import { validateFile } from '../../shared/file-validator.js';
import { saveAttachment, buildAttachmentPrompt } from '../../shared/attachments.js';
import { transcribeAudio } from '../../shared/speechmatics.js';
import { DatabaseManager } from '../../db/database.js';

export class SlackBot {
  public app: App;
  private permissionManager?: SlackPermissionManager;
  private channelNameCache = new Map<string, string>();
  private db: DatabaseManager;

  constructor(
    private config: SlackConfig,
    private claudeManager: SlackClaudeManager,
    private baseFolder: string,
  ) {
    this.db = new DatabaseManager();

    this.app = new App({
      token: config.botToken,
      appToken: config.appToken,
      signingSecret: config.signingSecret,
      socketMode: true,
    });

    // Increase ping/pong timeout from default 5s to 30s to avoid
    // "A pong wasn't received from the server before the timeout" warnings
    const receiver = (this.app as any).receiver;
    if (receiver?.client) {
      receiver.client.clientPingTimeoutMS = 30000;
    }

    this.setupEventHandlers();
  }

  setPermissionManager(permissionManager: SlackPermissionManager): void {
    this.permissionManager = permissionManager;
    permissionManager.setSlackClient(this.app.client);
  }

  private setupEventHandlers(): void {
    // Handle messages
    this.app.event('message', async ({ event, client }) => {
      await this.handleMessage(event as any, client);
    });

    // Handle reactions for approval
    this.app.event('reaction_added', async ({ event }) => {
      await this.handleReactionAdd(event as any);
    });

    // /clear slash command
    this.app.command('/clear', async ({ command, ack }) => {
      await ack();
      await this.handleClearCommand(command);
    });

    // /cancel slash command
    this.app.command('/cancel', async ({ command, ack }) => {
      await ack();
      await this.handleCancelCommand(command);
    });

    // /project slash command
    this.app.command('/project', async ({ command, ack }) => {
      await ack();
      await this.handleProjectCommand(command);
    });
  }

  private async handleMessage(event: any, client: any): Promise<void> {
    // Ignore bot messages and message edits
    if (event.bot_id || event.subtype) return;

    const userId = event.user;

    // Auth check
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) {
      return;
    }

    const channelId = event.channel;

    // Branch: DM vs channel
    if (this.isDMChannel(channelId)) {
      await this.handleDMMessage(event);
      return;
    }

    // --- Channel flow (unchanged) ---

    // Atomic check: if channel already processing, skip
    if (this.claudeManager.hasActiveProcess(channelId)) {
      console.log(`Slack: Channel ${channelId} is already processing, skipping`);
      return;
    }

    // Get channel name
    const channelName = await this.getChannelName(channelId);

    // Skip general channel
    if (channelName === 'general') {
      return;
    }

    // Only process allowed channels (if configured)
    if (this.config.allowedChannelIds.length > 0 && !this.config.allowedChannelIds.includes(channelId)) {
      return;
    }

    // Build prompt from text + attachments
    const workingDir = path.join(this.baseFolder, channelName);
    const prompt = await this.buildPromptFromEvent(event, channelId, workingDir);
    if (!prompt) {
      return;
    }

    console.log(`Slack: Received message in channel: ${channelName} (${channelId})`);
    console.log(`Slack: Message content: ${event.text}`);

    const sessionId = this.claudeManager.getSessionId(channelId);
    const isNewSession = !sessionId;

    try {
      // Send initial status message
      const statusText = isNewSession
        ? ':new: *Starting New Session*\nInitializing Claude Code...'
        : `:arrows_counterclockwise: *Continuing Session*\n*Session ID:* ${sessionId}\nResuming Claude Code...`;

      await this.app.client.chat.postMessage({
        channel: channelId,
        text: statusText,
      });

      // Create Slack context
      const slackContext = {
        channelId,
        channelName,
        userId,
        threadTs: event.thread_ts,
      };

      // Reserve and run
      this.claudeManager.reserveChannel(channelId, sessionId);
      await this.claudeManager.runClaudeCode(channelId, channelName, prompt, sessionId, slackContext);
    } catch (error) {
      console.error('Slack: Error running Claude Code:', error);
      this.claudeManager.clearSession(channelId);

      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: `Error: ${errorMessage}`,
        });
      } catch (sendError) {
        console.error('Slack: Failed to send error message:', sendError);
      }
    }
  }

  private async handleReactionAdd(event: any): Promise<void> {
    // Ignore bot reactions
    if (!event.user) return;

    // Only process from authorized users
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(event.user)) {
      return;
    }

    // Only process white_check_mark and x reactions
    if (event.reaction !== 'white_check_mark' && event.reaction !== 'x') return;

    console.log(`Slack: Reaction ${event.reaction} by ${event.user} on message ${event.item.ts}`);

    if (this.permissionManager) {
      const approved = event.reaction === 'white_check_mark';
      this.permissionManager.handleApprovalReaction(
        event.item.channel,
        event.item.ts,
        event.user,
        approved,
      );
    }
  }

  private async handleClearCommand(command: any): Promise<void> {
    const userId = command.user_id;

    // Auth check
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) {
      return;
    }

    const channelId = command.channel_id;

    try {
      if (this.isDMChannel(channelId)) {
        const projectName = this.db.getSlackUserProject(userId);
        if (!projectName) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: 'No project selected. Use `/project <name>` first.',
          });
          return;
        }
        const sessionKey = `slack:dm:${userId}:${projectName}`;
        this.claudeManager.clearSession(sessionKey);
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: `:broom: Session cleared for project: \`${projectName}\``,
        });
      } else {
        this.claudeManager.clearSession(channelId);
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: ':broom: Session cleared. Next message will start a new session.',
        });
      }
    } catch (error) {
      console.error('Slack: Error sending clear confirmation:', error);
    }
  }

  private async handleCancelCommand(command: any): Promise<void> {
    const userId = command.user_id;

    // Auth check
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) {
      return;
    }

    const channelId = command.channel_id;

    try {
      if (this.isDMChannel(channelId)) {
        const projectName = this.db.getSlackUserProject(userId);
        if (!projectName) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: 'No project selected. Use `/project <name>` first.',
          });
          return;
        }
        const sessionKey = `slack:dm:${userId}:${projectName}`;
        if (!this.claudeManager.hasActiveProcess(sessionKey)) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: 'No active task to cancel.',
          });
          return;
        }
        this.claudeManager.killActiveProcess(sessionKey);
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: `:stop_sign: Task cancelled for project: \`${projectName}\`. Session is preserved.`,
        });
      } else {
        if (!this.claudeManager.hasActiveProcess(channelId)) {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: 'No active task to cancel.',
          });
          return;
        }
        this.claudeManager.killActiveProcess(channelId);
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: ':stop_sign: Task cancelled. Session is preserved — you can continue chatting.',
        });
      }
    } catch (error) {
      console.error('Slack: Error sending cancel confirmation:', error);
    }
  }

  private async handleProjectCommand(command: any): Promise<void> {
    const channelId = command.channel_id;
    const userId = command.user_id;
    const text = (command.text || '').trim();

    // Auth check
    if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) {
      return;
    }

    try {
      if (!text) {
        // List projects
        let projects: string[] = [];
        try {
          projects = fs.readdirSync(this.baseFolder, { withFileTypes: true })
            .filter(d => d.isDirectory())
            .map(d => d.name)
            .sort();
        } catch {
          await this.app.client.chat.postMessage({
            channel: channelId,
            text: 'Could not read project directory.',
          });
          return;
        }

        const currentProject = this.db.getSlackUserProject(userId);
        const projectList = projects.length === 0
          ? 'No projects found.'
          : projects.map(p => {
              const marker = p === currentProject ? ':arrow_forward: ' : '    ';
              return `${marker}\`${p}\``;
            }).join('\n');

        await this.app.client.chat.postMessage({
          channel: channelId,
          text: `:file_folder: *Projects*\n\n${projectList}${currentProject ? `\n\n_Current: \`${currentProject}\`_` : ''}`,
        });
        return;
      }

      // /project <name>
      const projectName = text.split(/\s+/)[0];
      const projectDir = path.join(this.baseFolder, projectName);
      if (!fs.existsSync(projectDir)) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: `Project \`${projectName}\` not found. Use \`/project\` to see available projects.`,
        });
        return;
      }

      this.db.setSlackUserProject(userId, projectName);
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `:white_check_mark: Project set to: \`${projectName}\``,
      });
    } catch (error) {
      console.error('Slack: Error handling /project command:', error);
    }
  }

  private isDMChannel(channelId: string): boolean {
    return channelId.startsWith('D');
  }

  private async handleDMMessage(event: any): Promise<void> {
    const userId = event.user;
    const channelId = event.channel;
    const text = (event.text || '').trim();

    // Handle text commands
    if (text.startsWith('/project')) {
      await this.handleDMProjectCommand(channelId, userId, text);
      return;
    }
    if (text === '/clear') {
      const projectName = this.db.getSlackUserProject(userId);
      if (!projectName) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: 'No project selected. Use `/project <name>` first.',
        });
        return;
      }
      const sessionKey = `slack:dm:${userId}:${projectName}`;
      this.claudeManager.clearSession(sessionKey);
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `:broom: Session cleared for project: \`${projectName}\``,
      });
      return;
    }
    if (text === '/cancel') {
      const projectName = this.db.getSlackUserProject(userId);
      if (!projectName) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: 'No project selected. Use `/project <name>` first.',
        });
        return;
      }
      const sessionKey = `slack:dm:${userId}:${projectName}`;
      if (!this.claudeManager.hasActiveProcess(sessionKey)) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: 'No active task to cancel.',
        });
        return;
      }
      this.claudeManager.killActiveProcess(sessionKey);
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `:stop_sign: Task cancelled for project: \`${projectName}\`. Session is preserved.`,
      });
      return;
    }
    if (text === '/help') {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: [
          '*DM Commands:*',
          '`/project` - List available projects',
          '`/project <name>` - Set current project',
          '`/cancel` - Cancel the current running task',
          '`/clear` - Clear session for current project',
          '`/help` - Show this message',
          '',
          'Send any other message to run Claude Code on your selected project.',
        ].join('\n'),
      });
      return;
    }

    // Get selected project
    const projectName = this.db.getSlackUserProject(userId);
    if (!projectName) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: 'No project selected.\nUse `/project <name>` to set one, or `/project` to see available projects.',
      });
      return;
    }

    // Validate project directory
    const workingDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(workingDir)) {
      this.db.deleteSlackUserProject(userId);
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `Project directory \`${projectName}\` no longer exists. Use \`/project\` to select another.`,
      });
      return;
    }

    // Composite session key for DMs
    const sessionKey = `slack:dm:${userId}:${projectName}`;

    // Check active process
    if (this.claudeManager.hasActiveProcess(sessionKey)) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: 'A task is already running. Please wait for it to complete.',
      });
      return;
    }

    // Build prompt from text + attachments (reuse same logic as channels)
    let prompt = await this.buildPromptFromEvent(event, channelId, workingDir);
    if (!prompt || !prompt.trim()) {
      return;
    }

    console.log(`Slack: Received DM from ${userId}, project: ${projectName}`);

    const sessionId = this.claudeManager.getSessionId(sessionKey);
    const isNewSession = !sessionId;

    try {
      const statusText = isNewSession
        ? `:new: *Starting New Session* (\`${projectName}\`)\nInitializing Claude Code...`
        : `:arrows_counterclockwise: *Continuing Session* (\`${projectName}\`)\n*Session ID:* ${sessionId}\nResuming Claude Code...`;

      await this.app.client.chat.postMessage({
        channel: channelId,
        text: statusText,
      });

      const slackContext = {
        channelId,
        channelName: projectName,
        userId,
        threadTs: event.thread_ts,
      };

      this.claudeManager.reserveChannel(sessionKey, sessionId);
      await this.claudeManager.runClaudeCode(sessionKey, projectName, prompt, sessionId, slackContext, channelId);
    } catch (error) {
      console.error('Slack: Error running Claude Code (DM):', error);
      this.claudeManager.clearSession(sessionKey);

      const errorMessage = error instanceof Error ? error.message : String(error);
      try {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: `Error: ${errorMessage}`,
        });
      } catch (sendError) {
        console.error('Slack: Failed to send error message:', sendError);
      }
    }
  }

  private async handleDMProjectCommand(channelId: string, userId: string, text: string): Promise<void> {
    const parts = text.split(/\s+/);
    const subcommand = parts[1];

    if (!subcommand || subcommand === 'list') {
      // List projects
      let projects: string[] = [];
      try {
        projects = fs.readdirSync(this.baseFolder, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name)
          .sort();
      } catch {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: 'Could not read project directory.',
        });
        return;
      }

      const currentProject = this.db.getSlackUserProject(userId);
      const projectList = projects.length === 0
        ? 'No projects found.'
        : projects.map(p => {
            const marker = p === currentProject ? ':arrow_forward: ' : '    ';
            return `${marker}\`${p}\``;
          }).join('\n');

      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `:file_folder: *Projects*\n\n${projectList}${currentProject ? `\n\n_Current: \`${currentProject}\`_` : ''}`,
      });
      return;
    }

    // /project <name>
    const projectName = subcommand;
    const projectDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(projectDir)) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `Project \`${projectName}\` not found. Use \`/project\` to see available projects.`,
      });
      return;
    }

    this.db.setSlackUserProject(userId, projectName);
    await this.app.client.chat.postMessage({
      channel: channelId,
      text: `:white_check_mark: Project set to: \`${projectName}\``,
    });
  }

  private async buildPromptFromEvent(event: any, channelId: string, workingDir: string): Promise<string | null> {
    const allFiles = event.files || [];

    // Validate and categorize files
    const rejected: string[] = [];
    const validFiles: any[] = [];
    for (const f of allFiles) {
      const result = validateFile(f.name || 'unknown', f.size || 0);
      if (!result.allowed) {
        rejected.push(`${f.name}: ${result.reason}`);
      } else {
        validFiles.push({ ...f, _category: result.category });
      }
    }

    if (rejected.length > 0) {
      await this.app.client.chat.postMessage({
        channel: channelId,
        text: `Unsupported files:\n${rejected.join('\n')}`,
      });
    }

    // Download and save valid files
    const savedPaths = validFiles.length > 0
      ? await this.downloadAttachments(validFiles, workingDir)
      : [];

    // Check for audio files for voice transcription
    const audioFiles = validFiles.filter((f: any) => f._category === 'audio');
    let prompt = event.text || '';

    if (audioFiles.length > 0) {
      const speechmaticsApiKey = process.env.SPEECHMATICS_API_KEY;
      if (!speechmaticsApiKey) {
        await this.app.client.chat.postMessage({
          channel: channelId,
          text: 'Voice messages are not supported (SPEECHMATICS_API_KEY not set). Please send text.',
        });
      } else {
        const file = audioFiles[0];
        try {
          const response = await fetch(file.url_private, {
            headers: { 'Authorization': `Bearer ${this.config.botToken}` },
          });
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            const language = process.env.SPEECHMATICS_LANGUAGE || 'cmn';
            await this.app.client.chat.postMessage({ channel: channelId, text: 'Transcribing audio...' });
            const transcribedText = await transcribeAudio(speechmaticsApiKey, buffer, file.name || 'audio.ogg', language);
            if (transcribedText.trim()) {
              await this.app.client.chat.postMessage({ channel: channelId, text: `Transcription: "${transcribedText}"` });
              prompt = transcribedText;
            } else {
              await this.app.client.chat.postMessage({ channel: channelId, text: 'Could not transcribe audio (empty result).' });
            }
          }
        } catch (error) {
          console.error('Slack: Audio transcription error:', error);
          await this.app.client.chat.postMessage({ channel: channelId, text: 'Failed to transcribe audio.' });
        }
      }
    }

    // Append attachment paths to prompt
    const nonAudioPaths = savedPaths.filter(p => !audioFiles.some((f: any) => p.includes(f.name)));
    if (nonAudioPaths.length > 0) {
      prompt = prompt
        ? `${prompt}${buildAttachmentPrompt(nonAudioPaths)}`
        : `[User sent an image]${buildAttachmentPrompt(nonAudioPaths)}`;
    }

    return prompt.trim() || null;
  }

  private async getChannelName(channelId: string): Promise<string> {
    const cached = this.channelNameCache.get(channelId);
    if (cached) return cached;

    try {
      const result = await this.app.client.conversations.info({ channel: channelId });
      const name = (result.channel as any)?.name || 'default';
      this.channelNameCache.set(channelId, name);
      return name;
    } catch (error) {
      console.error('Slack: Error fetching channel name:', error);
      return 'default';
    }
  }

  private async downloadAttachments(files: any[], workingDir: string): Promise<string[]> {
    const savedPaths: string[] = [];
    for (const file of files) {
      try {
        const response = await fetch(file.url_private, {
          headers: { 'Authorization': `Bearer ${this.config.botToken}` },
        });
        if (!response.ok) {
          console.error(`Slack: Failed to download file ${file.name}: ${response.status}`);
          continue;
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        savedPaths.push(saveAttachment(workingDir, file.name || 'image.png', buffer));
        console.log(`Slack: Downloaded attachment: ${file.name}`);
      } catch (error) {
        console.error(`Slack: Error downloading file ${file.name}:`, error);
      }
    }
    return savedPaths;
  }

  async start(): Promise<void> {
    await this.app.start();
    console.log('Slack Bot is running in Socket Mode!');
  }

  async stop(): Promise<void> {
    await this.app.stop();
  }
}
