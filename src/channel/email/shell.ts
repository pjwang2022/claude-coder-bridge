import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

import type { EmailContext } from './types.js';

export function buildEmailClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  emailContext?: EmailContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'email',
    mcpServerName: 'email-permissions',
    permissionToolFqn: 'mcp__email-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__email-permissions',
    envVars: {
      EMAIL_FROM: emailContext?.from || 'unknown',
      EMAIL_PROJECT_NAME: emailContext?.projectName || 'unknown',
      EMAIL_MESSAGE_ID: emailContext?.messageId || '',
    },
    configFilePrefix: 'email',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
