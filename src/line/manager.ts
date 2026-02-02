import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager } from '../db/database.js';
import { spawnClaudeProcess, type ProcessHandle } from '../claude/process-runner.js';
import { buildLineClaudeCommand } from './shell.js';
import type { LineContext, TaskResultData } from './types.js';

export class LINEClaudeManager {
  private db: DatabaseManager;
  private activeProcesses = new Map<string, ProcessHandle>();

  constructor(private baseFolder: string, private channelAccessToken: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldLineTasks();
  }

  hasActiveProcess(userId: string, projectName: string): boolean {
    return this.activeProcesses.has(`${userId}:${projectName}`);
  }

  async runTask(userId: string, projectName: string, prompt: string): Promise<number> {
    const workingDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Project directory not found: ${workingDir}`);
    }

    const taskId = this.db.createLineTask(userId, projectName, prompt);

    const channelKey = `line:${userId}:${projectName}`;
    const sessionId = this.db.getSession(channelKey);

    const lineContext: LineContext = { userId, projectName };
    const commandString = buildLineClaudeCommand(workingDir, prompt, sessionId, lineContext);

    console.log(`LINE task ${taskId}: starting for user ${userId} in ${projectName}`);

    const toolCalls: Array<{ name: string; input: any }> = [];
    let finalResult = '';
    const processKey = `${userId}:${projectName}`;

    const handle = spawnClaudeProcess(
      commandString,
      {
        onInit: (parsed) => {
          console.log(`LINE task ${taskId}: session init ${parsed.session_id}`);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.db.updateLineTaskStatus(taskId, 'running', undefined, parsed.session_id);
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

          const status = parsed.subtype === 'success' ? 'completed' as const : 'failed' as const;
          this.db.updateLineTaskStatus(taskId, status, JSON.stringify(resultData), parsed.session_id);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.activeProcesses.delete(processKey);

          console.log(`LINE task ${taskId}: ${status} (${parsed.num_turns} turns)`);

          this.tryPushNotification(userId, taskId, status).catch(console.error);
        },

        onError: (error) => {
          console.error(`LINE task ${taskId}: error:`, error.message);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: error.message,
          };
          this.db.updateLineTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
        },

        onStderr: (text) => {
          console.error(`LINE task ${taskId} stderr:`, text);
        },

        onTimeout: () => {
          console.log(`LINE task ${taskId}: timed out`);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: 'Timeout (10 minutes)',
          };
          this.db.updateLineTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
        },
      },
      10 * 60 * 1000 // 10 minute timeout for LINE (async, longer than Discord)
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

    const channelKey = `line:${userId}:${projectName}`;
    this.db.clearSession(channelKey);
  }

  private async tryPushNotification(
    userId: string,
    taskId: number,
    status: 'completed' | 'failed'
  ): Promise<void> {
    try {
      // Check quota
      const quotaResp = await fetch('https://api.line.me/v2/bot/message/quota', {
        headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
      });
      const consumptionResp = await fetch('https://api.line.me/v2/bot/message/quota/consumption', {
        headers: { 'Authorization': `Bearer ${this.channelAccessToken}` },
      });

      if (!quotaResp.ok || !consumptionResp.ok) {
        console.log(`LINE task ${taskId}: Could not check quota, skipping push`);
        return;
      }

      const quota = await quotaResp.json() as { value: number };
      const consumption = await consumptionResp.json() as { totalUsage: number };
      const remaining = quota.value - consumption.totalUsage;

      if (remaining <= 0) {
        console.log(`LINE task ${taskId}: Push quota exhausted, skipping notification`);
        return;
      }

      const emoji = status === 'completed' ? '✅' : '❌';
      const response = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.channelAccessToken}`,
        },
        body: JSON.stringify({
          to: userId,
          messages: [{
            type: 'text',
            text: `${emoji} Task ${status}. Use /result to see details.`,
          }],
        }),
      });

      if (!response.ok) {
        console.error(`LINE task ${taskId}: Push notification failed:`, await response.text());
      }
    } catch (error) {
      console.error(`LINE task ${taskId}: Push notification error:`, error);
    }
  }

  destroy(): void {
    for (const [key, handle] of this.activeProcesses) {
      handle.kill();
    }
    this.activeProcesses.clear();
    this.db.close();
  }
}
