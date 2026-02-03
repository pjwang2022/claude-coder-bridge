import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

// --- Telegram Config ---

export interface TelegramConfig {
  botToken: string;
  allowedUserIds: number[]; // Telegram user IDs are numeric
}

// --- Telegram Context ---

export interface TelegramContext {
  userId: number;
  chatId: number;
  projectName: string;
}

// --- Permission ---

export interface PendingTelegramApproval extends PendingApprovalBase {
  telegramContext: TelegramContext;
  approvalChatId?: number;
  approvalMessageId?: number;
}

// --- Database Models ---

export type TaskStatus = 'running' | 'completed' | 'failed';

export interface TelegramTaskResult {
  id: number;
  userId: number;
  projectName: string;
  sessionId: string | null;
  status: TaskStatus;
  prompt: string;
  result: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface TaskResultData {
  toolCalls: Array<{ name: string; input: any }>;
  finalResult: string;
  numTurns?: number;
  costUsd?: number;
  error?: string;
}
