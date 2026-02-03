import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

import type { LineContext } from './types.js';

export function buildLineClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  lineContext?: LineContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'line',
    mcpServerName: 'line-permissions',
    permissionToolFqn: 'mcp__line-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__line-permissions',
    envVars: {
      LINE_USER_ID: lineContext?.userId || 'unknown',
      LINE_PROJECT_NAME: lineContext?.projectName || 'unknown',
    },
    configFilePrefix: 'line',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
