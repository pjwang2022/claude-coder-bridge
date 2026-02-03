import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

import type { TeamsContext } from './types.js';

export function buildTeamsClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  teamsContext?: TeamsContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'teams',
    mcpServerName: 'teams-permissions',
    permissionToolFqn: 'mcp__teams-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__teams-permissions',
    envVars: {
      TEAMS_USER_ID: teamsContext?.userId || 'unknown',
      TEAMS_CONVERSATION_ID: teamsContext?.conversationId || 'unknown',
      TEAMS_SERVICE_URL: teamsContext?.serviceUrl || 'unknown',
      TEAMS_PROJECT_NAME: teamsContext?.projectName || 'unknown',
    },
    configFilePrefix: 'teams',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
