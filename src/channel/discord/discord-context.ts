// Re-export shared utilities for backward compatibility
export { generateRequestId, requiresApproval } from '../../shared/permissions.js';
export type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

export interface DiscordContext {
  channelId: string;
  channelName: string;
  userId: string;
  messageId?: string;
}

export interface PendingApproval extends PendingApprovalBase {
  discordContext: DiscordContext;
  discordMessage?: any;
}

/**
 * Format tool information for Discord display
 */
export function formatToolForDiscord(toolName: string, input: any): string {
  const inputStr = JSON.stringify(input, null, 2);
  const truncatedInput = inputStr.length > 2000
    ? inputStr.substring(0, 2000) + '\n... (parameters truncated, review carefully)'
    : inputStr;

  return `**Tool:** \`${toolName}\`\n**Input:**\n\`\`\`json\n${truncatedInput}\n\`\`\``;
}
