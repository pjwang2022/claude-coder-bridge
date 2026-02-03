import { buildClaudeCommandCore, type PlatformBridgeConfig } from '../../shared/shell.js';

export { escapeShellString } from '../../shared/shell.js';

import type { TelegramContext } from './types.js';

export function buildTelegramClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  telegramContext?: TelegramContext,
): string {
  const bridgeConfig: PlatformBridgeConfig = {
    platform: 'telegram',
    mcpServerName: 'telegram-permissions',
    permissionToolFqn: 'mcp__telegram-permissions__approve_tool',
    allowedToolsPrefix: 'mcp__telegram-permissions',
    envVars: {
      TELEGRAM_USER_ID: String(telegramContext?.userId || 'unknown'),
      TELEGRAM_CHAT_ID: String(telegramContext?.chatId || 'unknown'),
      TELEGRAM_PROJECT_NAME: telegramContext?.projectName || 'unknown',
    },
    configFilePrefix: 'telegram',
  };

  return buildClaudeCommandCore(workingDir, prompt, bridgeConfig, sessionId);
}
