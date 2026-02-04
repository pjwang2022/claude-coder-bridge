import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';

export function escapeShellString(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

export interface PlatformBridgeConfig {
  platform: 'discord' | 'line' | 'slack' | 'telegram' | 'email' | 'webui';
  mcpServerName: string;
  permissionToolFqn: string;
  allowedToolsPrefix: string;
  envVars: Record<string, string>;
  configFilePrefix: string;
}

export function buildClaudeCommandCore(
  workingDir: string,
  prompt: string,
  bridgeConfig: PlatformBridgeConfig,
  sessionId?: string,
): string {
  const escapedPrompt = escapeShellString(prompt);
  const sessionMcpConfigPath = createSessionMcpConfig(bridgeConfig);

  const commandParts = [
    `cd ${workingDir}`,
    '&&',
    'claude',
    '--output-format', 'stream-json',
    '--model', 'sonnet',
    '-p', escapedPrompt,
    '--verbose',
    '--mcp-config', sessionMcpConfigPath,
    '--permission-prompt-tool', bridgeConfig.permissionToolFqn,
    '--allowedTools', bridgeConfig.allowedToolsPrefix,
  ];

  if (sessionId) {
    commandParts.splice(3, 0, '--resume', sessionId);
  }

  return commandParts.join(' ');
}

function createSessionMcpConfig(bridgeConfig: PlatformBridgeConfig): string {
  const id = `${bridgeConfig.configFilePrefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const configPath = path.join(os.tmpdir(), `mcp-config-${id}.json`);

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const baseDir = path.dirname(path.dirname(currentDir));
  const bridgeScriptPath = path.join(baseDir, 'mcp-bridge.cjs');

  const mcpConfig = {
    mcpServers: {
      [bridgeConfig.mcpServerName]: {
        command: 'node',
        args: [bridgeScriptPath],
        env: {
          ...bridgeConfig.envVars,
          PLATFORM: bridgeConfig.platform,
          MCP_SERVER_PORT: process.env.MCP_SERVER_PORT || '3001',
        },
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
  console.log(`Created session MCP config (${bridgeConfig.platform}): ${configPath}`);

  cleanupOldSessionConfigs(bridgeConfig.configFilePrefix);
  return configPath;
}

function cleanupOldSessionConfigs(prefix: string): void {
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const file of files) {
      if (file.startsWith(`mcp-config-${prefix}-`) && file.endsWith('.json')) {
        const filePath = path.join(tmpDir, file);
        const stats = fs.statSync(filePath);
        if (stats.mtime.getTime() < oneHourAgo) {
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch {
    // ignore cleanup errors
  }
}
