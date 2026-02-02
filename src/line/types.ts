import type { PermissionDecision } from '../mcp/permissions.js';

// --- LINE Webhook Event Types ---

export interface LineWebhookEvent {
  type: 'message' | 'postback' | 'follow' | 'unfollow' | 'join' | 'leave';
  replyToken: string;
  source: LineEventSource;
  timestamp: number;
  message?: LineMessageContent;
  postback?: { data: string };
}

export interface LineEventSource {
  type: 'user' | 'group' | 'room';
  userId: string;
  groupId?: string;
  roomId?: string;
}

export interface LineMessageContent {
  type: string;
  id: string;
  text?: string;
}

export interface LineWebhookBody {
  destination: string;
  events: LineWebhookEvent[];
}

// --- LINE Context ---

export interface LineContext {
  userId: string;
  projectName: string;
}

// --- LINE Config ---

export interface LineConfig {
  channelAccessToken: string;
  channelSecret: string;
  allowedUserIds: string[];
  baseFolder: string;
}

// --- Database Models ---

export type TaskStatus = 'running' | 'completed' | 'failed';

export interface LineTaskResult {
  id: number;
  userId: string;
  projectName: string;
  sessionId: string | null;
  status: TaskStatus;
  prompt: string;
  result: string | null;
  createdAt: number;
  completedAt: number | null;
}

export interface LineUserProject {
  userId: string;
  projectName: string;
  updatedAt: number;
}

// --- Task Result JSON Shape ---

export interface TaskResultData {
  toolCalls: Array<{ name: string; input: any }>;
  finalResult: string;
  numTurns?: number;
  costUsd?: number;
  error?: string;
}

// --- Permission ---

export interface PendingLineApproval {
  requestId: string;
  toolName: string;
  input: any;
  lineContext: LineContext;
  resolve: (decision: PermissionDecision) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  createdAt: Date;
}
