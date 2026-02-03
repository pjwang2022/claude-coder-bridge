import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

export interface TeamsConfig {
  appId: string;
  appPassword: string;
  allowedUserIds: string[];
}

export interface TeamsContext {
  userId: string;
  conversationId: string;
  serviceUrl: string;
  projectName: string;
}

export interface PendingTeamsApproval extends PendingApprovalBase {
  teamsContext: TeamsContext;
  approvalActivityId?: string;
}

export type TaskStatus = 'running' | 'completed' | 'failed';

export interface TeamsTaskResult {
  id: number;
  userId: string;
  projectName: string;
  sessionId: string | null;
  status: TaskStatus;
  prompt: string;
  result: string | null;
  conversationId: string;
  serviceUrl: string;
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
