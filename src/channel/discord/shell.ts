import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

export interface DiscordContext {
  channelId: string;
  channelName: string;
  userId: string;
  messageId?: string;
}

export function buildClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  discordContext?: DiscordContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'discord',
    mcpServerName: 'discord-permissions',
    permissionToolFqn: 'mcp__discord-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__discord-permissions',
    envVars: {
      DISCORD_CHANNEL_ID: discordContext?.channelId || 'unknown',
      DISCORD_CHANNEL_NAME: discordContext?.channelName || 'unknown',
      DISCORD_USER_ID: discordContext?.userId || 'unknown',
      DISCORD_MESSAGE_ID: discordContext?.messageId || '',
    },
    configFilePrefix: 'claude-discord',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
