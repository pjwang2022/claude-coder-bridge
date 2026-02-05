import type { MessageParam, ContentBlock, ToolUseBlock, TextBlock } from '@anthropic-ai/sdk/resources/messages';

export interface ApiRunnerOptions {
  workingDir: string;
  prompt: string;
  sessionId?: string;
  timeoutMs?: number;
  model?: string;
  maxTokens?: number;
  platformContext?: {
    platform: 'discord' | 'line' | 'slack' | 'telegram' | 'email' | 'webui';
    channelId?: string;
    userId?: string;
    permissionManager?: any;
  };
}

export interface ApiSessionData {
  sessionId: string;
  messages: MessageParam[];
  createdAt: number;
  lastUpdatedAt: number;
}

export interface ToolResult {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
}

export type { MessageParam, ContentBlock, ToolUseBlock, TextBlock };
