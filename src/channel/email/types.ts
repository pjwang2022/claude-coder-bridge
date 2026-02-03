import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

// --- Email Config ---

export interface EmailConfig {
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  emailUser: string;
  emailPass: string;
  allowedSenders: string[];
}

// --- Email Context ---

export interface EmailContext {
  from: string;
  subject: string;
  projectName: string;
  messageId: string;
  inReplyTo?: string;
}

// --- Permission ---

export interface PendingEmailApproval extends PendingApprovalBase {
  emailContext: EmailContext;
  approvalToken: string;
}

// --- Database Models ---

export type TaskStatus = 'running' | 'completed' | 'failed';

export interface EmailTaskResult {
  id: number;
  userEmail: string;
  projectName: string;
  sessionId: string | null;
  status: TaskStatus;
  prompt: string;
  result: string | null;
  messageId: string | null;
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
