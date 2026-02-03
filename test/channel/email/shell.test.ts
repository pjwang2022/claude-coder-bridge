import { describe, it, expect, afterEach } from 'vitest';
import { buildEmailClaudeCommand } from '../../../src/channel/email/shell.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('buildEmailClaudeCommand', () => {
  afterEach(() => {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith('mcp-config-email-') && file.endsWith('.json')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  });

  it('should build basic command without session ID', () => {
    const cmd = buildEmailClaudeCommand('/test/dir', 'hello');
    expect(cmd).toContain('cd /test/dir');
    expect(cmd).toContain('claude');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain("'hello'");
    expect(cmd).toContain('--permission-prompt-tool mcp__email-permissions__approve_tool');
    expect(cmd).toContain('--allowedTools mcp__email-permissions');
    expect(cmd).not.toContain('--resume');
  });

  it('should build command with session ID', () => {
    const cmd = buildEmailClaudeCommand('/test/dir', 'hello', 'session-123');
    expect(cmd).toContain('--resume session-123');
  });

  it('should create MCP config with email platform', () => {
    const emailContext = {
      from: 'user@example.com',
      subject: '[my-app] fix bug',
      projectName: 'my-app',
      messageId: '<msg123@example.com>',
    };

    const cmd = buildEmailClaudeCommand('/test/dir', 'hello', undefined, emailContext);
    expect(cmd).toContain('--mcp-config');

    const match = cmd.match(/--mcp-config\s+(\S+)/);
    expect(match).toBeTruthy();
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['email-permissions']).toBeDefined();
    expect(config.mcpServers['email-permissions'].env.PLATFORM).toBe('email');
    expect(config.mcpServers['email-permissions'].env.EMAIL_FROM).toBe('user@example.com');
    expect(config.mcpServers['email-permissions'].env.EMAIL_PROJECT_NAME).toBe('my-app');
    expect(config.mcpServers['email-permissions'].env.EMAIL_MESSAGE_ID).toBe('<msg123@example.com>');
  });

  it('should use defaults when no context provided', () => {
    const cmd = buildEmailClaudeCommand('/test/dir', 'hello');
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['email-permissions'].env.EMAIL_FROM).toBe('unknown');
    expect(config.mcpServers['email-permissions'].env.EMAIL_PROJECT_NAME).toBe('unknown');
    expect(config.mcpServers['email-permissions'].env.EMAIL_MESSAGE_ID).toBe('');
  });

  it('should properly escape prompt with special characters', () => {
    const cmd = buildEmailClaudeCommand('/test/dir', "it's a test");
    expect(cmd).toContain("'it'\\''s a test'");
  });
});
