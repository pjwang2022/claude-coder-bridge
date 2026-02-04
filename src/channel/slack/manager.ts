import * as path from 'path';
import * as fs from 'fs';
import type { WebClient } from '@slack/web-api';
import type { SDKMessage } from '../../types/index.js';
import { buildSlackClaudeCommand, type SlackContext } from './shell.js';
import { spawnClaudeProcess, type ProcessHandle } from '../../shared/process-runner.js';
import { DatabaseManager } from '../../db/database.js';
import { getProcessTimeoutMs } from '../../utils/config.js';
import { truncateWithSave } from '../../shared/message-truncator.js';
import { createThrottle } from '../../shared/throttle.js';
import { cleanupOldAttachments } from '../../shared/attachments.js';

export class SlackClaudeManager {
  private db: DatabaseManager;
  private slackClient: WebClient | null = null;
  private channelNames = new Map<string, string>();
  private channelToolCalls = new Map<string, Map<string, { channelId: string; messageTs: string; toolId: string }>>();
  private apiThrottle = createThrottle(500);
  private channelProcesses = new Map<
    string,
    {
      handle: ProcessHandle | null;
      sessionId?: string;
    }
  >();
  private channelIdMapping = new Map<string, string>(); // trackingKey → real Slack channelId

  constructor(private baseFolder: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldSessions();
  }

  setSlackClient(client: WebClient): void {
    this.slackClient = client;
  }

  hasActiveProcess(channelId: string): boolean {
    return this.channelProcesses.has(channelId);
  }

  killActiveProcess(channelId: string): void {
    const activeProcess = this.channelProcesses.get(channelId);
    if (activeProcess?.handle) {
      console.log(`Slack: Killing active process for channel ${channelId}`);
      activeProcess.handle.kill();
    }
  }

  clearSession(channelId: string): void {
    this.killActiveProcess(channelId);
    const channelName = this.channelNames.get(channelId);
    if (channelName) {
      cleanupOldAttachments(path.join(this.baseFolder, channelName, '.attachments'), 0);
    }
    this.db.clearSession(channelId);
    this.channelNames.delete(channelId);
    this.channelToolCalls.delete(channelId);
    this.channelProcesses.delete(channelId);
    this.channelIdMapping.delete(channelId);
  }

  reserveChannel(channelId: string, sessionId: string | undefined): void {
    const existingProcess = this.channelProcesses.get(channelId);
    if (existingProcess?.handle) {
      console.log(`Slack: Killing existing process for channel ${channelId} before starting new one`);
      existingProcess.handle.kill();
    }

    this.channelProcesses.set(channelId, {
      handle: null,
      sessionId,
    });
  }

  getSessionId(channelId: string): string | undefined {
    return this.db.getSession(channelId);
  }

  async runClaudeCode(
    channelId: string,
    channelName: string,
    prompt: string,
    sessionId?: string,
    slackContext?: SlackContext,
    postToChannelId?: string,
  ): Promise<void> {
    this.channelNames.set(channelId, channelName);
    this.channelToolCalls.set(channelId, new Map());
    this.channelIdMapping.set(channelId, postToChannelId || channelId);
    const workingDir = path.join(this.baseFolder, channelName);
    console.log(`Slack: Running Claude Code in: ${workingDir}`);

    if (!fs.existsSync(workingDir)) {
      throw new Error(`Working directory does not exist: ${workingDir}`);
    }

    const commandString = buildSlackClaudeCommand(workingDir, prompt, sessionId, slackContext);
    console.log(`Slack: Running command: ${commandString}`);

    const handle = spawnClaudeProcess(
      commandString,
      {
        onInit: (parsed) => {
          this.handleInitMessage(channelId, parsed).catch(console.error);
          this.db.setSession(channelId, parsed.session_id, channelName);
        },

        onAssistantMessage: (parsed) => {
          this.handleAssistantMessage(channelId, parsed).catch(console.error);
        },

        onToolResult: (parsed) => {
          this.handleToolResultMessage(channelId, parsed).catch(console.error);
        },

        onResult: (parsed) => {
          this.handleResultMessage(channelId, parsed).catch(console.error);
          this.db.setSession(channelId, parsed.session_id, channelName);
          this.channelProcesses.delete(channelId);
        },

        onError: (error) => {
          console.error(`Slack: Claude process error for channel ${channelId}:`, error.message);
          this.channelProcesses.delete(channelId);
          this.postMessage(channelId, `:x: *Claude Code Failed*\n${error.message}`).catch(console.error);
        },

        onStderr: (text) => {
          console.error(`Slack: Claude stderr (${channelId}):`, text);
          this.postMessage(channelId, `:warning: *Warning*\n${text}`).catch(console.error);
        },

        onTimeout: () => {
          console.log(`Slack: Claude process timed out for channel ${channelId}`);
          this.channelProcesses.delete(channelId);
          this.postMessage(channelId, `:alarm_clock: *Timeout*\nClaude Code took too long to respond (5 minutes)`).catch(console.error);
        },

        onClose: () => {
          this.channelProcesses.delete(channelId);
        },
      },
      getProcessTimeoutMs(),
      path.join(process.cwd(), 'log-slack.txt'),
    );

    const channelProcess = this.channelProcesses.get(channelId);
    if (channelProcess) {
      channelProcess.handle = handle;
    }
  }

  private async postMessage(channelId: string, text: string): Promise<string | undefined> {
    if (!this.slackClient) return undefined;
    const realChannelId = this.channelIdMapping.get(channelId) || channelId;
    try {
      const result = await this.apiThrottle(() =>
        this.slackClient!.chat.postMessage({ channel: realChannelId, text })
      );
      return result.ts;
    } catch (error) {
      console.error('Slack: Error posting message:', error);
      return undefined;
    }
  }

  private async updateMessage(channelId: string, ts: string, text: string): Promise<void> {
    if (!this.slackClient) return;
    const realChannelId = this.channelIdMapping.get(channelId) || channelId;
    try {
      await this.apiThrottle(() =>
        this.slackClient!.chat.update({ channel: realChannelId, ts, text })
      );
    } catch (error) {
      console.error('Slack: Error updating message:', error);
    }
  }

  private async handleInitMessage(channelId: string, parsed: any): Promise<void> {
    const text = `:rocket: *Claude Code Session Started*\n*Working Directory:* ${parsed.cwd}\n*Model:* ${parsed.model}\n*Tools:* ${parsed.tools.length} available`;
    await this.postMessage(channelId, text);
  }

  private async handleAssistantMessage(
    channelId: string,
    parsed: SDKMessage & { type: 'assistant' },
  ): Promise<void> {
    const content = Array.isArray(parsed.message.content)
      ? parsed.message.content.find((c: any) => c.type === 'text')?.text || ''
      : parsed.message.content;

    const toolUses = Array.isArray(parsed.message.content)
      ? parsed.message.content.filter((c: any) => c.type === 'tool_use')
      : [];

    const toolCalls = this.channelToolCalls.get(channelId) || new Map();
    const channelName = this.channelNames.get(channelId) || 'default';

    try {
      if (content && content.trim()) {
        await this.postMessage(channelId, `:speech_balloon: *Claude*\n${content}`);
      }

      for (const tool of toolUses) {
        let toolMessage = `:wrench: ${tool.name}`;

        if (tool.input && Object.keys(tool.input).length > 0) {
          const inputs = Object.entries(tool.input)
            .map(([key, value]) => {
              let val = String(value);
              if (channelName) {
                const basePath = `${this.baseFolder}${channelName}`;
                if (val === basePath) {
                  val = '.';
                } else if (val.startsWith(basePath + '/')) {
                  val = val.replace(basePath + '/', './');
                }
              }
              return `${key}=${val}`;
            })
            .join(', ');
          toolMessage += ` (${inputs})`;
        }

        const messageTs = await this.postMessage(channelId, `:hourglass_flowing_sand: ${toolMessage}`);
        if (messageTs) {
          toolCalls.set(tool.id, { channelId, messageTs, toolId: tool.id });
        }
      }

      this.db.setSession(channelId, parsed.session_id, channelName);
      this.channelToolCalls.set(channelId, toolCalls);
    } catch (error) {
      console.error('Slack: Error sending assistant message:', error);
    }
  }

  private async handleToolResultMessage(channelId: string, parsed: any): Promise<void> {
    const toolResults = Array.isArray(parsed.message.content)
      ? parsed.message.content.filter((c: any) => c.type === 'tool_result')
      : [];

    if (toolResults.length === 0) return;

    const toolCalls = this.channelToolCalls.get(channelId) || new Map();

    for (const result of toolResults) {
      const toolCall = toolCalls.get(result.tool_use_id);
      if (toolCall) {
        const firstLine = result.content.split('\n')[0].trim();
        const resultText = firstLine.length > 100
          ? firstLine.substring(0, 100) + '...'
          : firstLine;

        const isError = result.is_error === true;
        const icon = isError ? ':x:' : ':white_check_mark:';
        const updatedText = `${icon} ${toolCall.toolId ? toolCall.messageTs : ''}\n_${resultText}_`;

        // Reconstruct the tool message with result
        await this.updateMessage(
          toolCall.channelId,
          toolCall.messageTs,
          `${icon} ${result.tool_use_id}\n_${resultText}_`,
        );
      }
    }
  }

  private async handleResultMessage(
    channelId: string,
    parsed: SDKMessage & { type: 'result' },
  ): Promise<void> {
    console.log('Slack: Result message:', parsed);
    const channelName = this.channelNames.get(channelId) || 'default';
    this.db.setSession(channelId, parsed.session_id, channelName);

    let text: string;
    if (parsed.subtype === 'success') {
      let description = 'result' in parsed ? parsed.result : 'Task completed';
      const workingDir = path.join(this.baseFolder, channelName);
      const truncated = truncateWithSave(description, 'slack', workingDir);
      description = truncated.text;
      text = `:white_check_mark: *Session Complete*\n${description}\n\n_Completed in ${parsed.num_turns} turns_`;
    } else {
      text = `:x: *Session Failed*\nTask failed: ${parsed.subtype}`;
    }

    await this.postMessage(channelId, text);
  }

  destroy(): void {
    for (const [channelId] of this.channelProcesses) {
      this.killActiveProcess(channelId);
    }
    this.db.close();
  }
}
