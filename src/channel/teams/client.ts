import * as fs from 'fs';
import * as path from 'path';
import {
  BotFrameworkAdapter,
  TurnContext,
  ActivityHandler,
  CardFactory,
  type Activity,
} from 'botbuilder';
import type { Application } from 'express';
import type { TeamsConfig } from './types.js';
import type { TeamsClaudeManager } from './manager.js';
import type { TeamsPermissionManager } from './permission-manager.js';
import {
  buildResultCard,
  buildProjectListCard,
  buildHelpMessage,
  buildStatusMessage,
} from './messages.js';
import { validateFile } from '../../shared/file-validator.js';
import { saveAttachment, buildAttachmentPrompt } from '../../shared/attachments.js';
import { transcribeAudio } from '../../shared/speechmatics.js';

export class TeamsBot extends ActivityHandler {
  public adapter: BotFrameworkAdapter;
  private config: TeamsConfig;
  private claudeManager: TeamsClaudeManager;
  private permissionManager: TeamsPermissionManager;
  private baseFolder: string;

  constructor(
    config: TeamsConfig,
    claudeManager: TeamsClaudeManager,
    permissionManager: TeamsPermissionManager,
    baseFolder: string,
  ) {
    super();
    this.config = config;
    this.claudeManager = claudeManager;
    this.permissionManager = permissionManager;
    this.baseFolder = baseFolder;

    this.adapter = new BotFrameworkAdapter({
      appId: config.appId,
      appPassword: config.appPassword,
    });

    this.adapter.onTurnError = async (_context, error) => {
      console.error('Teams bot turn error:', error);
    };

    this.setupHandlers();
  }

  registerRoutes(app: Application): void {
    app.post('/teams/messages', async (req, res) => {
      await this.adapter.process(req, res, (context) => this.run(context));
    });
    console.log('Teams route registered: POST /teams/messages');
  }

  private setupHandlers(): void {
    this.onMessage(async (context, next) => {
      const userId = context.activity.from?.aadObjectId || context.activity.from?.id || '';
      const conversationId = context.activity.conversation?.id || '';
      const serviceUrl = context.activity.serviceUrl || '';

      // Store conversation reference for proactive messaging
      const ref = TurnContext.getConversationReference(context.activity);
      this.claudeManager.storeConversationReference(userId, ref);
      this.permissionManager.storeConversationReference(userId, ref);

      // Check if this is a card action (Adaptive Card submit)
      if (context.activity.value) {
        this.permissionManager.handleCardAction(userId, context.activity.value);
        await next();
        return;
      }

      // Check allowed users
      if (this.config.allowedUserIds.length > 0 && !this.config.allowedUserIds.includes(userId)) {
        await context.sendActivity('You are not authorized to use this bot.');
        await next();
        return;
      }

      const text = (context.activity.text || '').trim();
      const hasFileAttachments = (context.activity.attachments || []).some(a =>
        a.contentType?.startsWith('image/') ||
        a.contentType?.startsWith('audio/') ||
        a.contentType === 'application/vnd.microsoft.teams.file.download.info'
      );

      if (!text && !hasFileAttachments) {
        await next();
        return;
      }

      // Parse commands
      if (text.startsWith('/')) {
        await this.handleCommand(context, userId, conversationId, serviceUrl, text);
      } else {
        await this.handlePrompt(context, userId, conversationId, serviceUrl, text);
      }

      await next();
    });
  }

  private async handleCommand(
    context: TurnContext,
    userId: string,
    conversationId: string,
    serviceUrl: string,
    text: string,
  ): Promise<void> {
    const parts = text.split(/\s+/);
    const cmd = (parts[0] || '').toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/project': {
        if (args) {
          // Select project
          const projectDir = `${this.baseFolder}/${args}`;
          if (!fs.existsSync(projectDir)) {
            await context.sendActivity(`Project directory not found: ${args}`);
            return;
          }
          this.claudeManager.setUserProject(userId, args);
          await context.sendActivity(`Project set to **${args}**`);
        } else {
          // List projects
          const projects = this.getProjectList();
          const current = this.claudeManager.getUserProject(userId);
          const card = buildProjectListCard(projects, current);
          await context.sendActivity({
            attachments: [CardFactory.adaptiveCard(card)],
          });
        }
        break;
      }

      case '/result': {
        const task = this.claudeManager.getLatestTask(userId);
        if (!task) {
          await context.sendActivity('No task results found.');
          return;
        }
        const card = buildResultCard(task);
        await context.sendActivity({
          attachments: [CardFactory.adaptiveCard(card)],
        });
        break;
      }

      case '/status': {
        const running = this.claudeManager.getRunningTasks(userId);
        await context.sendActivity(buildStatusMessage(running));
        break;
      }

      case '/clear': {
        const project = this.claudeManager.getUserProject(userId);
        if (!project) {
          await context.sendActivity('No project selected. Use `/project <name>` first.');
          return;
        }
        this.claudeManager.clearSession(userId, project);
        await context.sendActivity(`Session cleared for **${project}**`);
        break;
      }

      case '/help':
        await context.sendActivity(buildHelpMessage());
        break;

      default:
        await context.sendActivity(`Unknown command: ${cmd}. Use \`/help\` for available commands.`);
    }
  }

  private async handlePrompt(
    context: TurnContext,
    userId: string,
    conversationId: string,
    serviceUrl: string,
    text: string,
  ): Promise<void> {
    const project = this.claudeManager.getUserProject(userId);
    if (!project) {
      await context.sendActivity('No project selected. Use `/project <name>` to select one first.');
      return;
    }

    if (this.claudeManager.hasActiveProcess(userId, project)) {
      await context.sendActivity(`A task is already running in **${project}**. Wait for it to finish or use \`/clear\`.`);
      return;
    }

    let prompt = text;

    // Process attachments (images, audio, files)
    const rawAttachments = context.activity.attachments || [];
    const fileAttachments = rawAttachments.filter(a =>
      a.contentType?.startsWith('image/') ||
      a.contentType?.startsWith('audio/') ||
      a.contentType === 'application/vnd.microsoft.teams.file.download.info'
    );

    if (fileAttachments.length > 0) {
      const workingDir = path.join(this.baseFolder, project);
      const savedPaths: string[] = [];
      const rejected: string[] = [];

      for (const att of fileAttachments) {
        try {
          let downloadUrl: string | undefined;
          let filename: string;
          let estimatedSize = 0;

          if (att.contentType === 'application/vnd.microsoft.teams.file.download.info') {
            downloadUrl = att.content?.downloadUrl;
            filename = att.name || 'file';
            estimatedSize = att.content?.fileSize || 0;
          } else {
            downloadUrl = att.contentUrl;
            filename = att.name || `file.${att.contentType?.split('/')[1] || 'bin'}`;
          }

          if (!downloadUrl) continue;

          const validation = validateFile(filename, estimatedSize);
          if (!validation.allowed) {
            rejected.push(`${filename}: ${validation.reason}`);
            continue;
          }

          const response = await fetch(downloadUrl);
          if (!response.ok) continue;
          const buffer = Buffer.from(await response.arrayBuffer());

          if (validation.category === 'audio') {
            const speechmaticsApiKey = process.env.SPEECHMATICS_API_KEY;
            if (speechmaticsApiKey) {
              const language = process.env.SPEECHMATICS_LANGUAGE || 'cmn';
              const transcribed = await transcribeAudio(speechmaticsApiKey, buffer, filename, language);
              if (transcribed.trim()) {
                prompt = transcribed + (prompt ? `\n\n${prompt}` : '');
              }
            }
          } else {
            savedPaths.push(saveAttachment(workingDir, filename, buffer));
          }
        } catch (error) {
          console.error('Teams: Error processing attachment:', error);
        }
      }

      if (rejected.length > 0) {
        await context.sendActivity(`Rejected files: ${rejected.join(', ')}`);
      }

      if (savedPaths.length > 0) {
        prompt += buildAttachmentPrompt(savedPaths);
      }
    }

    if (!prompt) {
      await context.sendActivity('Please provide a message or supported file.');
      return;
    }

    try {
      const taskId = await this.claudeManager.runTask(userId, conversationId, serviceUrl, project, prompt);
      await context.sendActivity(`Task #${taskId} started in **${project}**. You'll be notified when it's done.`);
    } catch (error: any) {
      await context.sendActivity(`Failed to start task: ${error.message}`);
    }
  }

  private getProjectList(): string[] {
    try {
      const entries = fs.readdirSync(this.baseFolder, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }
}
