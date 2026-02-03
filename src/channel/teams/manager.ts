import * as path from 'path';
import * as fs from 'fs';
import type { BotFrameworkAdapter, ConversationReference, TurnContext } from 'botbuilder';
import { DatabaseManager } from '../../db/database.js';
import { spawnClaudeProcess, type ProcessHandle } from '../../shared/process-runner.js';
import { buildTeamsClaudeCommand } from './shell.js';
import type { TeamsContext, TaskResultData } from './types.js';
import { getProcessTimeoutMs } from '../../utils/config.js';
import { cleanupOldAttachments } from '../../shared/attachments.js';
import { truncateWithSave } from '../../shared/message-truncator.js';

export class TeamsClaudeManager {
  private db: DatabaseManager;
  private activeProcesses = new Map<string, ProcessHandle>();
  private adapter?: BotFrameworkAdapter;
  private conversationRefs = new Map<string, Partial<ConversationReference>>();

  constructor(private baseFolder: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldTeamsTasks();
  }

  setAdapter(adapter: BotFrameworkAdapter): void {
    this.adapter = adapter;
  }

  storeConversationReference(userId: string, ref: Partial<ConversationReference>): void {
    this.conversationRefs.set(userId, ref);
  }

  hasActiveProcess(userId: string, projectName: string): boolean {
    return this.activeProcesses.has(`${userId}:${projectName}`);
  }

  async runTask(
    userId: string,
    conversationId: string,
    serviceUrl: string,
    projectName: string,
    prompt: string,
  ): Promise<number> {
    const workingDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Project directory not found: ${workingDir}`);
    }

    const taskId = this.db.createTeamsTask(userId, projectName, prompt, conversationId, serviceUrl);

    const channelKey = `teams:${userId}:${projectName}`;
    const sessionId = this.db.getSession(channelKey);

    const teamsContext: TeamsContext = { userId, conversationId, serviceUrl, projectName };
    const commandString = buildTeamsClaudeCommand(workingDir, prompt, sessionId, teamsContext);

    console.log(`Teams task ${taskId}: starting for user ${userId} in ${projectName}`);

    const toolCalls: Array<{ name: string; input: any }> = [];
    let finalResult = '';
    const processKey = `${userId}:${projectName}`;

    const handle = spawnClaudeProcess(
      commandString,
      {
        onInit: (parsed) => {
          console.log(`Teams task ${taskId}: session init ${parsed.session_id}`);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.db.updateTeamsTaskStatus(taskId, 'running', undefined, parsed.session_id);
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
          // Tool results accumulated via tool calls
        },

        onResult: (parsed) => {
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: 'result' in parsed ? (parsed as any).result : finalResult,
            numTurns: parsed.num_turns,
            costUsd: parsed.total_cost_usd,
          };

          const truncated = truncateWithSave(resultData.finalResult, 'teams', workingDir);
          resultData.finalResult = truncated.text;

          const status = parsed.subtype === 'success' ? 'completed' as const : 'failed' as const;
          this.db.updateTeamsTaskStatus(taskId, status, JSON.stringify(resultData), parsed.session_id);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.activeProcesses.delete(processKey);

          console.log(`Teams task ${taskId}: ${status} (${parsed.num_turns} turns)`);
          this.tryPushNotification(userId, taskId, status).catch(console.error);
        },

        onError: (error) => {
          console.error(`Teams task ${taskId}: error:`, error.message);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: error.message,
          };
          this.db.updateTeamsTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
          this.tryPushNotification(userId, taskId, 'failed').catch(console.error);
        },

        onStderr: (text) => {
          console.error(`Teams task ${taskId} stderr:`, text);
        },

        onTimeout: () => {
          console.log(`Teams task ${taskId}: timed out`);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: 'Process timed out',
          };
          this.db.updateTeamsTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
          this.tryPushNotification(userId, taskId, 'failed').catch(console.error);
        },
      },
      getProcessTimeoutMs(),
    );

    this.activeProcesses.set(processKey, handle);
    return taskId;
  }

  clearSession(userId: string, projectName: string): void {
    const processKey = `${userId}:${projectName}`;
    const handle = this.activeProcesses.get(processKey);
    if (handle) {
      handle.kill();
      this.activeProcesses.delete(processKey);
    }

    cleanupOldAttachments(path.join(this.baseFolder, projectName, '.attachments'), 0);

    const channelKey = `teams:${userId}:${projectName}`;
    this.db.clearSession(channelKey);
  }

  getLatestTask(userId: string): any {
    return this.db.getLatestTeamsTask(userId);
  }

  getRunningTasks(userId: string): any[] {
    return this.db.getRunningTeamsTasks(userId);
  }

  getUserProject(userId: string): string | undefined {
    return this.db.getTeamsUserProject(userId);
  }

  setUserProject(userId: string, projectName: string): void {
    this.db.setTeamsUserProject(userId, projectName);
  }

  private async tryPushNotification(
    userId: string,
    taskId: number,
    status: 'completed' | 'failed',
  ): Promise<void> {
    if (!this.adapter) {
      console.log(`Teams task ${taskId}: No adapter set, skipping push notification`);
      return;
    }

    const ref = this.conversationRefs.get(userId);
    if (!ref) {
      console.log(`Teams task ${taskId}: No conversation ref for user ${userId}`);
      return;
    }

    try {
      const emoji = status === 'completed' ? '\u2705' : '\u274C';
      await this.adapter.continueConversation(ref, async (turnContext: TurnContext) => {
        await turnContext.sendActivity(`${emoji} Task ${status}. Use \`/result\` to see details.`);
      });
    } catch (error) {
      console.error(`Teams task ${taskId}: Push notification error:`, error);
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
