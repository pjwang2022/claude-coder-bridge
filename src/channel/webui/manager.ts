import * as path from 'path';
import * as fs from 'fs';
import { DatabaseManager, type WebUIChatMessage, type WebUISession } from '../../db/database.js';
import { getProcessTimeoutMs } from '../../utils/config.js';
import { cleanupOldAttachments } from '../../shared/attachments.js';
import { spawnClaudeProcess, type ProcessHandle } from '../../shared/process-runner.js';
import { buildWebUIClaudeCommand } from './shell.js';
import type { WebUIContext } from './types.js';
import {
  buildSystemInitPayload,
  buildAssistantMessagePayload,
  buildToolResultPayload,
  buildResultPayload,
  buildErrorPayload,
} from './messages.js';

export type SendFunction = (connectionId: string, payload: any) => void;

export class WebUIClaudeManager {
  private db: DatabaseManager;
  private connectionProcesses = new Map<string, { handle: ProcessHandle | null; sessionId?: string }>();
  private sendFunction?: SendFunction;

  constructor(private baseFolder: string) {
    this.db = new DatabaseManager();
    this.db.cleanupOldSessions();
    this.db.cleanupOldWebUIChatMessages();
  }

  setSendFunction(fn: SendFunction): void {
    this.sendFunction = fn;
  }

  private send(connectionId: string, payload: any): void {
    this.sendFunction?.(connectionId, payload);
  }

  hasActiveProcess(connectionId: string, project: string, sessionName: string = 'default'): boolean {
    return this.connectionProcesses.has(`${connectionId}:${project}:${sessionName}`);
  }

  getSessionId(project: string, sessionName: string = 'default'): string | undefined {
    return this.db.getWebUISessionClaudeId(project, sessionName);
  }

  cancelTask(connectionId: string, project: string, sessionName: string = 'default'): void {
    const processKey = `${connectionId}:${project}:${sessionName}`;
    const active = this.connectionProcesses.get(processKey);
    if (active?.handle) {
      console.log(`WebUI: Cancelling task for ${connectionId} in ${project}/${sessionName}`);
      active.handle.kill();
    }
    this.connectionProcesses.delete(processKey);
  }

  clearSession(connectionId: string, project: string, sessionName: string = 'default'): void {
    const processKey = `${connectionId}:${project}:${sessionName}`;
    const active = this.connectionProcesses.get(processKey);
    if (active?.handle) {
      active.handle.kill();
    }
    this.connectionProcesses.delete(processKey);

    cleanupOldAttachments(path.join(this.baseFolder, project, '.attachments'), 0);

    this.db.clearWebUIChatMessages(project, sessionName);
    // Reset the Claude session ID for this session
    this.db.setWebUISessionClaudeId(project, sessionName, '');
  }

  getSessions(project: string): WebUISession[] {
    return this.db.getWebUISessions(project);
  }

  createSession(project: string, sessionName: string): void {
    this.db.createWebUISession(project, sessionName);
  }

  deleteSession(project: string, sessionName: string): void {
    this.db.deleteWebUISession(project, sessionName);
  }

  renameSession(project: string, sessionName: string, displayName: string): void {
    this.db.renameWebUISession(project, sessionName, displayName);
  }

  getChatHistory(project: string, limit: number, beforeId?: number, sessionName: string = 'default'): WebUIChatMessage[] {
    return this.db.getWebUIChatMessages(project, limit, beforeId, sessionName);
  }

  async runClaudeCode(
    connectionId: string,
    project: string,
    prompt: string,
    sessionName: string = 'default',
  ): Promise<void> {
    const workingDir = path.join(this.baseFolder, project);

    if (!fs.existsSync(workingDir)) {
      this.send(connectionId, buildErrorPayload(`Project directory not found: ${workingDir}`));
      return;
    }

    const processKey = `${connectionId}:${project}:${sessionName}`;

    // Kill existing process if any
    const existing = this.connectionProcesses.get(processKey);
    if (existing?.handle) {
      existing.handle.kill();
    }

    // Ensure session exists in DB
    this.db.createWebUISession(project, sessionName);

    const sessionId = this.db.getWebUISessionClaudeId(project, sessionName);

    this.connectionProcesses.set(processKey, { handle: null, sessionId });

    // Save user message to history
    this.db.saveWebUIChatMessage(project, 'user', prompt, undefined, sessionName);

    const webUIContext: WebUIContext = { connectionId, project };
    const commandString = buildWebUIClaudeCommand(workingDir, prompt, sessionId || undefined, webUIContext);

    console.log(`WebUI: Running Claude Code for ${connectionId} in ${project}/${sessionName}`);

    // Helper: add sessionName to all outgoing payloads so frontend can route them
    const sendCtx = (payload: any) => {
      this.send(connectionId, { ...payload, sessionName });
    };

    const handle = spawnClaudeProcess(
      commandString,
      {
        onInit: (parsed) => {
          this.db.setWebUISessionClaudeId(project, sessionName, parsed.session_id);
          const systemText = `Session started | ${parsed.cwd} | Model: ${parsed.model}`;
          this.db.saveWebUIChatMessage(project, 'system', systemText, undefined, sessionName);
          sendCtx(buildSystemInitPayload(
            parsed.session_id,
            parsed.cwd,
            parsed.model,
          ));
        },

        onAssistantMessage: (parsed) => {
          const content = Array.isArray(parsed.message.content)
            ? parsed.message.content.find((c: any) => c.type === 'text')?.text || ''
            : parsed.message.content;

          const toolUses = Array.isArray(parsed.message.content)
            ? parsed.message.content.filter((c: any) => c.type === 'tool_use')
            : [];

          if (content) {
            this.db.saveWebUIChatMessage(project, 'assistant', content, undefined, sessionName);
          }
          for (const tool of toolUses) {
            this.db.saveWebUIChatMessage(project, 'tool_call',
              JSON.stringify({ name: tool.name, id: tool.id, input: tool.input }),
              undefined, sessionName,
            );
          }

          sendCtx(buildAssistantMessagePayload(content, toolUses));
          this.db.setWebUISessionClaudeId(project, sessionName, parsed.session_id);
        },

        onToolResult: (parsed) => {
          const results = Array.isArray(parsed.message.content)
            ? parsed.message.content.filter((c: any) => c.type === 'tool_result')
            : [];

          for (const result of results) {
            const firstLine = result.content?.split('\n')[0]?.trim() || '';
            const text = firstLine.length > 200 ? firstLine.substring(0, 200) + '...' : firstLine;
            this.db.saveWebUIChatMessage(project, 'tool_result',
              JSON.stringify({ toolId: result.tool_use_id, result: text, isError: result.is_error === true }),
              undefined, sessionName,
            );
            sendCtx(buildToolResultPayload(
              result.tool_use_id,
              text,
              result.is_error === true,
            ));
          }
        },

        onResult: (parsed) => {
          this.db.setWebUISessionClaudeId(project, sessionName, parsed.session_id);
          this.connectionProcesses.delete(processKey);

          const status = parsed.subtype === 'success' ? 'success' : 'error';
          this.db.saveWebUIChatMessage(project, 'result',
            JSON.stringify({ status, turns: parsed.num_turns, cost: parsed.total_cost_usd }),
            undefined, sessionName,
          );

          sendCtx(buildResultPayload(
            status,
            '',
            parsed.num_turns,
            parsed.total_cost_usd,
            parsed.session_id,
          ));
        },

        onError: (error) => {
          console.error(`WebUI process error (${connectionId}):`, error.message);
          this.connectionProcesses.delete(processKey);
          sendCtx(buildErrorPayload(error.message));
        },

        onStderr: (text) => {
          console.error(`WebUI stderr (${connectionId}):`, text);
        },

        onTimeout: () => {
          const timeoutMinutes = Math.round(getProcessTimeoutMs() / 60000);
          console.log(`WebUI process timed out (${connectionId})`);
          this.connectionProcesses.delete(processKey);
          sendCtx(buildErrorPayload(`Claude Code timed out (${timeoutMinutes} minutes)`));
        },

        onClose: (_code) => {
          this.connectionProcesses.delete(processKey);
        },
      },
      getProcessTimeoutMs(),
      path.join(process.cwd(), 'log.txt'),
    );

    const proc = this.connectionProcesses.get(processKey);
    if (proc) {
      proc.handle = handle;
    }
  }

  disconnectConnection(connectionId: string): void {
    for (const [key, proc] of this.connectionProcesses) {
      if (key.startsWith(`${connectionId}:`)) {
        proc.handle?.kill();
        this.connectionProcesses.delete(key);
      }
    }
  }

  destroy(): void {
    for (const [, proc] of this.connectionProcesses) {
      proc.handle?.kill();
    }
    this.connectionProcesses.clear();
    this.db.close();
  }
}
