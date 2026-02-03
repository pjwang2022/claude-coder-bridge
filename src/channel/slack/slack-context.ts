export { generateRequestId, requiresApproval } from '../../shared/permissions.js';
export type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

import type { PendingApprovalBase } from '../../shared/base-permission-manager.js';

export interface SlackContext {
  channelId: string;
  channelName: string;
  userId: string;
  threadTs?: string;
}

export interface PendingSlackApproval extends PendingApprovalBase {
  slackContext: SlackContext;
  approvalChannelId?: string;
  approvalMessageTs?: string;
}

/**
 * Format tool information for Slack display
 */
export function formatToolForSlack(toolName: string, input: any): string {
  const inputStr = JSON.stringify(input, null, 2);
  const truncatedInput = inputStr.length > 2000
    ? inputStr.substring(0, 2000) + '\n... (parameters truncated, review carefully)'
    : inputStr;

  return `*Tool:* \`${toolName}\`\n*Input:*\n\`\`\`${truncatedInput}\`\`\``;
}
