import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { escapeShellString } from '../utils/shell.js';
import type { LineContext } from './types.js';

export function buildLineClaudeCommand(
  workingDir: string,
  prompt: string,
  sessionId?: string,
  lineContext?: LineContext
): string {
  const escapedPrompt = escapeShellString(prompt);
  const sessionMcpConfigPath = createLineSessionMcpConfig(lineContext);

  const commandParts = [
    `cd ${workingDir}`,
    '&&',
    'claude',
    '--output-format', 'stream-json',
    '--model', 'sonnet',
    '-p', escapedPrompt,
    '--verbose',
    '--mcp-config', sessionMcpConfigPath,
    '--permission-prompt-tool', 'mcp__line-permissions__approve_tool',
    '--allowedTools', 'mcp__line-permissions',
  ];

  if (sessionId) {
    commandParts.splice(3, 0, '--resume', sessionId);
  }

  return commandParts.join(' ');
}

function createLineSessionMcpConfig(lineContext?: LineContext): string {
  const sessionId = `line-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const configPath = path.join(os.tmpdir(), `mcp-config-${sessionId}.json`);

  const baseDir = path.dirname(path.dirname(__dirname));
  const bridgeScriptPath = path.join(baseDir, 'line-mcp-bridge.cjs');

  const mcpConfig = {
    mcpServers: {
      'line-permissions': {
        command: 'node',
        args: [bridgeScriptPath],
        env: {
          LINE_USER_ID: lineContext?.userId || 'unknown',
          LINE_PROJECT_NAME: lineContext?.projectName || 'unknown',
        },
      },
    },
  };

  fs.writeFileSync(configPath, JSON.stringify(mcpConfig, null, 2));
  console.log(`Created LINE session MCP config: ${configPath}`);

  cleanupOldLineSessionConfigs();
  return configPath;
}

function cleanupOldLineSessionConfigs(): void {
  try {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const file of files) {
      if (file.startsWith('mcp-config-line-') && file.endsWith('.json')) {
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
