import type { PermissionDecision } from '../../shared/permissions.js';
import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

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
  type: 'text' | 'audio' | 'image' | 'video' | 'file' | 'sticker' | 'location';
  id: string;
  text?: string;
  duration?: number;
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
  speechmaticsApiKey?: string;
  speechmaticsLanguage: string;
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

export interface PendingLineApproval extends PendingApprovalBase {
  lineContext: LineContext;
}
