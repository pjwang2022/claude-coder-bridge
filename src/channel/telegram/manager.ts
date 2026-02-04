import * as path from 'path';
import * as fs from 'fs';
import type { Telegraf } from 'telegraf';
import { DatabaseManager } from '../../db/database.js';
import { spawnClaudeProcess, type ProcessHandle } from '../../shared/process-runner.js';
import { buildTelegramClaudeCommand } from './shell.js';
import type { TelegramContext, TaskResultData } from './types.js';
import { getProcessTimeoutMs } from '../../utils/config.js';
import { cleanupOldAttachments } from '../../shared/attachments.js';
import { truncateWithSave } from '../../shared/message-truncator.js';

export class TelegramClaudeManager {
  private db: DatabaseManager;
  private activeProcesses = new Map<string, ProcessHandle>();
  private bot?: Telegraf;

  constructor(private baseFolder: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldTelegramTasks();
  }

  setBot(bot: Telegraf): void {
    this.bot = bot;
  }

  hasActiveProcess(userId: number, projectName: string): boolean {
    return this.activeProcesses.has(`${userId}:${projectName}`);
  }

  async runTask(userId: number, chatId: number, projectName: string, prompt: string): Promise<number> {
    const workingDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Project directory not found: ${workingDir}`);
    }

    const taskId = this.db.createTelegramTask(userId, projectName, prompt);

    const channelKey = `telegram:${userId}:${projectName}`;
    const sessionId = this.db.getSession(channelKey);

    const telegramContext: TelegramContext = { userId, chatId, projectName };
    const commandString = buildTelegramClaudeCommand(workingDir, prompt, sessionId, telegramContext);

    console.log(`Telegram task ${taskId}: starting for user ${userId} in ${projectName}`);

    const toolCalls: Array<{ name: string; input: any }> = [];
    let finalResult = '';
    const processKey = `${userId}:${projectName}`;

    const handle = spawnClaudeProcess(
      commandString,
      {
        onInit: (parsed) => {
          console.log(`Telegram task ${taskId}: session init ${parsed.session_id}`);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.db.updateTelegramTaskStatus(taskId, 'running', undefined, parsed.session_id);
        },

        onAssistantMessage: (parsed) => {
          const content = Array.isArray(parsed.message.content)
            ? parsed.message.content.find((c: any) => c.type === 'text')?.text || ''
            : parsed.message.content;
          if (content) finalResult = content;

          const tools = Array.isArray(parsed.message.content)
            ? parsed.message.content.filter((c: any) => c.type === 'tool_use')
            : [];
          for (const t of tools) {
            toolCalls.push({ name: t.name, input: t.input });
          }

          this.db.setSession(channelKey, parsed.session_id, projectName);
        },

        onToolResult: () => {
          // Tool results are accumulated via tool calls above
        },

        onResult: (parsed) => {
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: 'result' in parsed ? (parsed as any).result : finalResult,
            numTurns: parsed.num_turns,
            costUsd: parsed.total_cost_usd,
          };

          const truncated = truncateWithSave(resultData.finalResult, 'telegram', workingDir);
          resultData.finalResult = truncated.text;

          const status = parsed.subtype === 'success' ? 'completed' as const : 'failed' as const;
          this.db.updateTelegramTaskStatus(taskId, status, JSON.stringify(resultData), parsed.session_id);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.activeProcesses.delete(processKey);

          console.log(`Telegram task ${taskId}: ${status} (${parsed.num_turns} turns)`);

          this.tryPushNotification(chatId, taskId, status).catch(console.error);
        },

        onError: (error) => {
          console.error(`Telegram task ${taskId}: error:`, error.message);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: error.message,
          };
          this.db.updateTelegramTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
          this.tryPushNotification(chatId, taskId, 'failed').catch(console.error);
        },

        onStderr: (text) => {
          console.error(`Telegram task ${taskId} stderr:`, text);
        },

        onTimeout: () => {
          console.log(`Telegram task ${taskId}: timed out`);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: 'Process timed out',
          };
          this.db.updateTelegramTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
          this.tryPushNotification(chatId, taskId, 'failed').catch(console.error);
        },
      },
      getProcessTimeoutMs(),
    );

    this.activeProcesses.set(processKey, handle);
    return taskId;
  }

  cancelTask(userId: number, projectName: string): void {
    const processKey = `${userId}:${projectName}`;
    const handle = this.activeProcesses.get(processKey);
    if (handle) {
      console.log(`Telegram: Cancelling task for ${userId} in ${projectName}`);
      handle.kill();
      this.activeProcesses.delete(processKey);
    }
  }

  clearSession(userId: number, projectName: string): void {
    const processKey = `${userId}:${projectName}`;
    const handle = this.activeProcesses.get(processKey);
    if (handle) {
      handle.kill();
      this.activeProcesses.delete(processKey);
    }

    cleanupOldAttachments(path.join(this.baseFolder, projectName, '.attachments'), 0);

    const channelKey = `telegram:${userId}:${projectName}`;
    this.db.clearSession(channelKey);
  }

  private async tryPushNotification(
    chatId: number,
    taskId: number,
    status: 'completed' | 'failed',
  ): Promise<void> {
    if (!this.bot) {
      console.log(`Telegram task ${taskId}: No bot set, skipping push notification`);
      return;
    }

    try {
      const emoji = status === 'completed' ? '✅' : '❌';
      await this.bot.telegram.sendMessage(
        chatId,
        `${emoji} Task ${status}. Use /result to see details.`,
      );
    } catch (error) {
      console.error(`Telegram task ${taskId}: Push notification error:`, error);
    }
  }

  destroy(): void {
    for (const [, handle] of this.activeProcesses) {
      handle.kill();
    }
    this.activeProcesses.clear();
    this.db.close();
  }
}
