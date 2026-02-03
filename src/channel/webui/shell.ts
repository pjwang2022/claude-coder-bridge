import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

import type { WebUIContext } from './types.js';

export function buildWebUIClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  webUIContext?: WebUIContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'webui',
    mcpServerName: 'webui-permissions',
    permissionToolFqn: 'mcp__webui-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__webui-permissions',
    envVars: {
      WEBUI_CONNECTION_ID: webUIContext?.connectionId || 'unknown',
      WEBUI_PROJECT: webUIContext?.project || 'unknown',
    },
    configFilePrefix: 'webui',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
