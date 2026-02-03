import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

export interface SlackContext {
  channelId: string;
  channelName: string;
  userId: string;
  threadTs?: string;
}

export function buildSlackClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  slackContext?: SlackContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'slack',
    mcpServerName: 'slack-permissions',
    permissionToolFqn: 'mcp__slack-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__slack-permissions',
    envVars: {
      SLACK_CHANNEL_ID: slackContext?.channelId || 'unknown',
      SLACK_CHANNEL_NAME: slackContext?.channelName || 'unknown',
      SLACK_USER_ID: slackContext?.userId || 'unknown',
      SLACK_THREAD_TS: slackContext?.threadTs || '',
    },
    configFilePrefix: 'claude-slack',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
