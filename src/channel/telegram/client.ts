import { Telegraf } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';
import type { TelegramConfig } from './types.js';
import type { TelegramClaudeManager } from './manager.js';
import type { TelegramPermissionManager } from './permission-manager.js';
import { DatabaseManager } from '../../db/database.js';
import { transcribeAudio } from '../../shared/speechmatics.js';
import { saveAttachment, buildAttachmentPrompt } from '../../shared/attachments.js';
import { validateFile } from '../../shared/file-validator.js';
import {
  buildResultMessage,
  buildProjectListMessage,
  buildProcessingMessage,
  buildStatusMessage,
  buildHelpMessage,
} from './messages.js';

export class TelegramBot {
  public bot: Telegraf;
  private db: DatabaseManager;
  private allowedUserIds: number[];
  private speechmaticsApiKey: string;
  private speechmaticsLanguage: string;

  constructor(
    config: TelegramConfig,
    private claudeManager: TelegramClaudeManager,
    private permissionManager: TelegramPermissionManager,
    private baseFolder: string,
  ) {
    this.bot = new Telegraf(config.botToken);
    this.db = new DatabaseManager();
    this.allowedUserIds = config.allowedUserIds;
    this.speechmaticsApiKey = process.env.SPEECHMATICS_API_KEY || '';
    this.speechmaticsLanguage = process.env.SPEECHMATICS_LANGUAGE || 'cmn';
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Commands
    this.bot.command('start', (ctx) => this.handleStart(ctx));
    this.bot.command('project', (ctx) => this.handleProjectCommand(ctx));
    this.bot.command('result', (ctx) => this.handleResultCommand(ctx));
    this.bot.command('status', (ctx) => this.handleStatusCommand(ctx));
    this.bot.command('clear', (ctx) => this.handleClearCommand(ctx));
    this.bot.command('cancel', (ctx) => this.handleCancelCommand(ctx));
    this.bot.command('help', (ctx) => this.handleHelpCommand(ctx));

    // Callback queries (approval buttons)
    this.bot.on('callback_query', (ctx) => {
      const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
      if (!data) return;

      const userId = ctx.callbackQuery.from.id;

      if (!this.isAuthorized(userId)) {
        ctx.answerCbQuery('Unauthorized').catch(() => {});
        return;
      }

      this.permissionManager.handleCallbackQuery(userId, data);
      ctx.answerCbQuery().catch(() => {});
    });

    // Photo messages
    this.bot.on('photo', (ctx) => this.handlePhoto(ctx));

    // Voice messages
    this.bot.on('voice', (ctx) => this.handleVoice(ctx));

    // Text messages (non-command)
    this.bot.on('text', (ctx) => this.handleTextMessage(ctx));
  }

  private isAuthorized(userId: number): boolean {
    if (this.allowedUserIds.length === 0) return true;
    return this.allowedUserIds.includes(userId);
  }

  private async handleStart(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    await ctx.reply(
      'Welcome! I run Claude Code on your projects.\n\n' + buildHelpMessage(),
    );
  }

  private async handleProjectCommand(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    const text: string = ctx.message?.text || '';
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
        await ctx.reply('Could not read project directory.');
        return;
      }
      const currentProject = this.db.getTelegramUserProject(userId);
      const msg = buildProjectListMessage(projects, currentProject);
      await ctx.reply(msg.text, { parse_mode: msg.parseMode });
      return;
    }

    // /project <name>
    const projectName = subcommand;
    const projectDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(projectDir)) {
      await ctx.reply(`Project "${projectName}" not found. Use /project to see available projects.`);
      return;
    }

    this.db.setTelegramUserProject(userId, projectName);
    await ctx.reply(`Project set to: ${projectName}`);
  }

  private async handleResultCommand(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    const task = this.db.getLatestTelegramTask(userId);

    if (!task) {
      await ctx.reply('No tasks found.');
      return;
    }

    if (task.status === 'running') {
      const elapsed = Math.round((Date.now() - task.createdAt) / 1000);
      await ctx.reply(`Task is still running (${elapsed}s elapsed). Try again later.`);
      return;
    }

    const msg = buildResultMessage(task);
    await ctx.reply(msg.text, { parse_mode: msg.parseMode });
  }

  private async handleStatusCommand(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    const running = this.db.getRunningTelegramTasks(userId);
    await ctx.reply(buildStatusMessage(running));
  }

  private async handleClearCommand(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    const projectName = this.db.getTelegramUserProject(userId);
    if (!projectName) {
      await ctx.reply('No project selected. Use /project <name> first.');
      return;
    }

    this.claudeManager.clearSession(userId, projectName);
    await ctx.reply(`Session cleared for project: ${projectName}`);
  }

  private async handleCancelCommand(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    const projectName = this.db.getTelegramUserProject(userId);
    if (!projectName) {
      await ctx.reply('No project selected. Use /project <name> first.');
      return;
    }

    if (!this.claudeManager.hasActiveProcess(userId, projectName)) {
      await ctx.reply('No active task to cancel.');
      return;
    }

    this.claudeManager.cancelTask(userId, projectName);
    await ctx.reply(`Task cancelled for project: ${projectName}. Session is preserved.`);
  }

  private async handleHelpCommand(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId || !this.isAuthorized(userId)) return;

    await ctx.reply(buildHelpMessage());
  }

  private async handleTextMessage(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId || !this.isAuthorized(userId)) return;

    const text: string = ctx.message?.text?.trim();
    if (!text) return;

    await this.runClaudeTask(ctx, userId, chatId, text);
  }

  private async handlePhoto(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId || !this.isAuthorized(userId)) return;

    const projectName = this.db.getTelegramUserProject(userId);
    if (!projectName) {
      await ctx.reply('No project selected.\nUse /project <name> to set one.\nUse /project to see available projects.');
      return;
    }

    // Get the largest photo (last in array)
    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) return;
    const photo = photos[photos.length - 1];

    const validation = validateFile(`${photo.file_id}.jpg`, photo.file_size || 0);
    if (!validation.allowed) {
      await ctx.reply(`File rejected: ${validation.reason}`);
      return;
    }

    await ctx.reply('🖼️ Image received, processing...');

    try {
      const fileLink = await this.bot.telegram.getFileLink(photo.file_id);
      const response = await fetch(fileLink.href);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const imageBuffer = Buffer.from(arrayBuffer);

      const workingDir = path.join(this.baseFolder, projectName);
      const savedPath = saveAttachment(workingDir, `${photo.file_id.substring(0, 16)}.jpg`, imageBuffer);

      console.log(`Telegram: Saved image to ${savedPath}`);

      const caption = ctx.message?.caption ? `${ctx.message.caption}\n\n` : '';
      const prompt = `${caption}[User sent an image]${buildAttachmentPrompt([savedPath])}`;
      await this.runClaudeTask(ctx, userId, chatId, prompt);
    } catch (error) {
      console.error('Telegram image handling error:', error);
      await ctx.reply(`Image processing error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleVoice(ctx: any): Promise<void> {
    const userId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    if (!userId || !chatId || !this.isAuthorized(userId)) return;

    if (!this.speechmaticsApiKey) {
      await ctx.reply('Voice messages are not supported. Please send text.');
      return;
    }

    const voice = ctx.message?.voice;
    if (!voice) return;

    const validation = validateFile('audio.ogg', voice.file_size || 0);
    if (!validation.allowed) {
      await ctx.reply(`File rejected: ${validation.reason}`);
      return;
    }

    await ctx.reply('🎙️ Transcribing audio...');

    try {
      const fileLink = await this.bot.telegram.getFileLink(voice.file_id);
      const response = await fetch(fileLink.href);
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = Buffer.from(arrayBuffer);

      const transcribedText = await transcribeAudio(
        this.speechmaticsApiKey,
        audioBuffer,
        'audio.ogg',
        this.speechmaticsLanguage,
      );

      if (!transcribedText.trim()) {
        await ctx.reply('Could not transcribe audio (empty result).');
        return;
      }

      await ctx.reply(`📝 "${transcribedText}"`);
      await this.runClaudeTask(ctx, userId, chatId, transcribedText);
    } catch (error) {
      console.error('Telegram voice transcription error:', error);
      await ctx.reply(`Transcription error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async runClaudeTask(
    ctx: any,
    userId: number,
    chatId: number,
    prompt: string,
  ): Promise<void> {
    const projectName = this.db.getTelegramUserProject(userId);

    if (!projectName) {
      await ctx.reply(
        'No project selected.\nUse /project <name> to set one.\nUse /project to see available projects.',
      );
      return;
    }

    if (this.claudeManager.hasActiveProcess(userId, projectName)) {
      await ctx.reply('A task is already running for this project. Use /status to check.');
      return;
    }

    await ctx.reply(buildProcessingMessage());

    try {
      const taskId = await this.claudeManager.runTask(userId, chatId, projectName, prompt);
      console.log(`Telegram: Task ${taskId} started for ${userId} in ${projectName}`);
    } catch (error) {
      console.error('Telegram: Claude task error:', error);
      await ctx.reply(`Error starting task: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async start(): Promise<void> {
    await this.bot.launch();
    console.log('Telegram bot started (long polling).');
  }

  async stop(): Promise<void> {
    this.bot.stop('SIGTERM');
  }
}
