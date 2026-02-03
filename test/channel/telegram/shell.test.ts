import { describe, it, expect, afterEach } from 'vitest';
import { buildTelegramClaudeCommand } from '../../../src/channel/telegram/shell.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('buildTelegramClaudeCommand', () => {
  afterEach(() => {
    // Clean up temp files
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith('mcp-config-telegram-') && file.endsWith('.json')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  });

  it('should build basic command without session ID', () => {
    const cmd = buildTelegramClaudeCommand('/test/dir', 'hello');
    expect(cmd).toContain('cd /test/dir');
    expect(cmd).toContain('claude');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain("'hello'");
    expect(cmd).toContain('--permission-prompt-tool mcp__telegram-permissions__approve_tool');
    expect(cmd).toContain('--allowedTools mcp__telegram-permissions');
    expect(cmd).not.toContain('--resume');
  });

  it('should build command with session ID', () => {
    const cmd = buildTelegramClaudeCommand('/test/dir', 'hello', 'session-123');
    expect(cmd).toContain('--resume session-123');
  });

  it('should create MCP config with telegram platform', () => {
    const telegramContext = {
      userId: 123456789,
      chatId: 987654321,
      projectName: 'test-project',
    };

    const cmd = buildTelegramClaudeCommand('/test/dir', 'hello', undefined, telegramContext);
    expect(cmd).toContain('--mcp-config');

    // Extract config path from command
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    expect(match).toBeTruthy();
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['telegram-permissions']).toBeDefined();
    expect(config.mcpServers['telegram-permissions'].env.PLATFORM).toBe('telegram');
    expect(config.mcpServers['telegram-permissions'].env.TELEGRAM_USER_ID).toBe('123456789');
    expect(config.mcpServers['telegram-permissions'].env.TELEGRAM_CHAT_ID).toBe('987654321');
    expect(config.mcpServers['telegram-permissions'].env.TELEGRAM_PROJECT_NAME).toBe('test-project');
  });

  it('should use defaults when no context provided', () => {
    const cmd = buildTelegramClaudeCommand('/test/dir', 'hello');
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['telegram-permissions'].env.TELEGRAM_USER_ID).toBe('unknown');
    expect(config.mcpServers['telegram-permissions'].env.TELEGRAM_CHAT_ID).toBe('unknown');
    expect(config.mcpServers['telegram-permissions'].env.TELEGRAM_PROJECT_NAME).toBe('unknown');
  });

  it('should properly escape prompt with special characters', () => {
    const cmd = buildTelegramClaudeCommand('/test/dir', "it's a test");
    expect(cmd).toContain("'it'\\''s a test'");
  });
});
