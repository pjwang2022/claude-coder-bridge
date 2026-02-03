import type { WebUIChatMessage, WebUISession } from '../../db/database.js';

export interface WebUIPayload {
  type: string;
  [key: string]: any;
}

export function buildAuthResultPayload(success: boolean, message?: string): WebUIPayload {
  return { type: 'auth_result', success, message };
}

export function buildProjectListPayload(projects: string[]): WebUIPayload {
  return { type: 'projects', list: projects };
}

export function buildSystemInitPayload(sessionId: string, cwd: string, model: string): WebUIPayload {
  return { type: 'system_init', sessionId, cwd, model };
}

export function buildAssistantMessagePayload(text: string, toolCalls: any[]): WebUIPayload {
  return { type: 'assistant_message', text, toolCalls };
}

export function buildToolResultPayload(toolId: string, result: string, isError: boolean): WebUIPayload {
  return { type: 'tool_result', toolId, result, isError };
}

export function buildResultPayload(
  status: string,
  text: string,
  turns?: number,
  cost?: number,
  sessionId?: string,
): WebUIPayload {
  return { type: 'result', status, text, turns, cost, sessionId };
}

export function buildErrorPayload(message: string): WebUIPayload {
  return { type: 'error', message };
}

export function buildApprovalRequestPayload(requestId: string, toolName: string, input: any): WebUIPayload {
  return { type: 'approval_request', requestId, toolName, input };
}

export function buildBusyPayload(project: string, sessionName?: string): WebUIPayload {
  const label = sessionName ? `project "${project}" session "${sessionName}"` : `project "${project}"`;
  return { type: 'busy', project, message: `A Claude process is already running in ${label}. Wait for it to finish or clear the session.` };
}

export function buildSessionListPayload(sessions: WebUISession[]): WebUIPayload {
  return {
    type: 'sessions',
    list: sessions.map(s => ({
      name: s.sessionName,
      displayName: s.displayName || s.sessionName,
      createdAt: s.createdAt,
      lastUsed: s.lastUsed,
    })),
  };
}

export function buildChatHistoryPayload(messages: WebUIChatMessage[], hasMore: boolean): WebUIPayload {
  return { type: 'chat_history', messages, hasMore };
}
