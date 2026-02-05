import type { MessageParam, ContentBlock, ToolResult } from './types.js';

/**
 * Manages conversation history for API mode.
 * Since the Anthropic API is stateless, we need to track messages ourselves.
 */
export class ApiSessionManager {
  private sessionId: string;
  private messages: MessageParam[] = [];

  constructor(existingSessionId?: string) {
    this.sessionId = existingSessionId || this.generateSessionId();
  }

  private generateSessionId(): string {
    return `api_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getMessages(): MessageParam[] {
    return this.messages;
  }

  addUserMessage(content: string): void {
    this.messages.push({ role: 'user', content });
  }

  addAssistantMessage(content: ContentBlock[]): void {
    this.messages.push({ role: 'assistant', content });
  }

  addToolResults(results: ToolResult[]): void {
    this.messages.push({
      role: 'user',
      content: results.map((r) => ({
        type: 'tool_result' as const,
        tool_use_id: r.tool_use_id,
        content: r.content,
        is_error: r.is_error,
      })),
    });
  }

  /**
   * Serialize session for potential persistence
   */
  serialize(): string {
    return JSON.stringify({
      sessionId: this.sessionId,
      messages: this.messages,
    });
  }

  /**
   * Restore session from serialized data
   */
  static deserialize(data: string): ApiSessionManager {
    const { sessionId, messages } = JSON.parse(data);
    const manager = new ApiSessionManager(sessionId);
    manager.messages = messages;
    return manager;
  }

  /**
   * Clear all messages (for /clear command support)
   */
  clear(): void {
    this.messages = [];
  }

  /**
   * Get total message count for context tracking
   */
  getMessageCount(): number {
    return this.messages.length;
  }
}
