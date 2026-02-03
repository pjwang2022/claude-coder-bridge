import * as path from 'path';
import * as fs from 'fs';
import type { Transporter } from 'nodemailer';
import { DatabaseManager } from '../../db/database.js';
import { spawnClaudeProcess, type ProcessHandle } from '../../shared/process-runner.js';
import { buildEmailClaudeCommand } from './shell.js';
import { buildResultEmail } from './messages.js';
import type { EmailContext, TaskResultData } from './types.js';
import { getProcessTimeoutMs } from '../../utils/config.js';
import { cleanupOldAttachments } from '../../shared/attachments.js';
import { truncateWithSave } from '../../shared/message-truncator.js';

export class EmailClaudeManager {
  private db: DatabaseManager;
  private activeProcesses = new Map<string, ProcessHandle>();
  private transporter?: Transporter;
  private botEmail: string = '';

  constructor(private baseFolder: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldEmailTasks();
  }

  setTransporter(transporter: Transporter): void {
    this.transporter = transporter;
  }

  setBotEmail(email: string): void {
    this.botEmail = email;
  }

  hasActiveProcess(userEmail: string, projectName: string): boolean {
    return this.activeProcesses.has(`${userEmail}:${projectName}`);
  }

  async runTask(
    userEmail: string,
    projectName: string,
    prompt: string,
    messageId: string,
  ): Promise<number> {
    const workingDir = path.join(this.baseFolder, projectName);
    if (!fs.existsSync(workingDir)) {
      throw new Error(`Project directory not found: ${workingDir}`);
    }

    const taskId = this.db.createEmailTask(userEmail, projectName, prompt, messageId);

    const channelKey = `email:${userEmail}:${projectName}`;
    const sessionId = this.db.getSession(channelKey);

    const emailContext: EmailContext = {
      from: userEmail,
      subject: '',
      projectName,
      messageId,
    };
    const commandString = buildEmailClaudeCommand(workingDir, prompt, sessionId, emailContext);

    console.log(`Email task ${taskId}: starting for ${userEmail} in ${projectName}`);

    const toolCalls: Array<{ name: string; input: any }> = [];
    let finalResult = '';
    const processKey = `${userEmail}:${projectName}`;

    const handle = spawnClaudeProcess(
      commandString,
      {
        onInit: (parsed) => {
          console.log(`Email task ${taskId}: session init ${parsed.session_id}`);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.db.updateEmailTaskStatus(taskId, 'running', undefined, parsed.session_id);
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

        onToolResult: () => {},

        onResult: (parsed) => {
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: 'result' in parsed ? (parsed as any).result : finalResult,
            numTurns: parsed.num_turns,
            costUsd: parsed.total_cost_usd,
          };

          const truncated = truncateWithSave(resultData.finalResult, 'email', workingDir);
          resultData.finalResult = truncated.text;

          const status = parsed.subtype === 'success' ? 'completed' as const : 'failed' as const;
          this.db.updateEmailTaskStatus(taskId, status, JSON.stringify(resultData), parsed.session_id);
          this.db.setSession(channelKey, parsed.session_id, projectName);
          this.activeProcesses.delete(processKey);

          console.log(`Email task ${taskId}: ${status} (${parsed.num_turns} turns)`);

          this.sendResultEmail(userEmail, taskId, messageId).catch(console.error);
        },

        onError: (error) => {
          console.error(`Email task ${taskId}: error:`, error.message);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: error.message,
          };
          this.db.updateEmailTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
          this.sendResultEmail(userEmail, taskId, messageId).catch(console.error);
        },

        onStderr: (text) => {
          console.error(`Email task ${taskId} stderr:`, text);
        },

        onTimeout: () => {
          console.log(`Email task ${taskId}: timed out`);
          const resultData: TaskResultData = {
            toolCalls,
            finalResult: '',
            error: 'Timeout (10 minutes)',
          };
          this.db.updateEmailTaskStatus(taskId, 'failed', JSON.stringify(resultData));
          this.activeProcesses.delete(processKey);
          this.sendResultEmail(userEmail, taskId, messageId).catch(console.error);
        },
      },
      getProcessTimeoutMs(),
    );

    this.activeProcesses.set(processKey, handle);
    return taskId;
  }

  clearSession(userEmail: string, projectName: string): void {
    const processKey = `${userEmail}:${projectName}`;
    const handle = this.activeProcesses.get(processKey);
    if (handle) {
      handle.kill();
      this.activeProcesses.delete(processKey);
    }

    cleanupOldAttachments(path.join(this.baseFolder, projectName, '.attachments'), 0);

    const channelKey = `email:${userEmail}:${projectName}`;
    this.db.clearSession(channelKey);
  }

  private async sendResultEmail(
    userEmail: string,
    taskId: number,
    originalMessageId: string,
  ): Promise<void> {
    if (!this.transporter) {
      console.log(`Email task ${taskId}: No transporter set, skipping result email`);
      return;
    }

    try {
      const task = this.db.getEmailTask(taskId);
      if (!task) return;

      const msg = buildResultEmail(task);

      await this.transporter.sendMail({
        from: this.botEmail,
        to: userEmail,
        subject: msg.subject,
        html: msg.html,
        inReplyTo: originalMessageId,
        references: originalMessageId,
      });

      console.log(`Email task ${taskId}: Result email sent to ${userEmail}`);
    } catch (error) {
      console.error(`Email task ${taskId}: Failed to send result email:`, error);
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
