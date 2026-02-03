import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildSlackClaudeCommand } from '../../../src/channel/slack/shell.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('buildSlackClaudeCommand', () => {
  afterEach(() => {
    // Clean up temp files
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith('mcp-config-claude-slack-') && file.endsWith('.json')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  });

  it('should build basic command without session ID', () => {
    const cmd = buildSlackClaudeCommand('/test/dir', 'hello');
    expect(cmd).toContain('cd /test/dir');
    expect(cmd).toContain('claude');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain("'hello'");
    expect(cmd).toContain('--permission-prompt-tool mcp__slack-permissions__approve_tool');
    expect(cmd).toContain('--allowedTools mcp__slack-permissions');
    expect(cmd).not.toContain('--resume');
  });

  it('should build command with session ID', () => {
    const cmd = buildSlackClaudeCommand('/test/dir', 'hello', 'session-123');
    expect(cmd).toContain('--resume session-123');
  });

  it('should create MCP config with slack platform', () => {
    const slackContext = {
      channelId: 'C123',
      channelName: 'test-channel',
      userId: 'U456',
      threadTs: '1234.5678',
    };

    const cmd = buildSlackClaudeCommand('/test/dir', 'hello', undefined, slackContext);
    expect(cmd).toContain('--mcp-config');

    // Extract config path from command
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    expect(match).toBeTruthy();
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['slack-permissions']).toBeDefined();
    expect(config.mcpServers['slack-permissions'].env.PLATFORM).toBe('slack');
    expect(config.mcpServers['slack-permissions'].env.SLACK_CHANNEL_ID).toBe('C123');
    expect(config.mcpServers['slack-permissions'].env.SLACK_CHANNEL_NAME).toBe('test-channel');
    expect(config.mcpServers['slack-permissions'].env.SLACK_USER_ID).toBe('U456');
    expect(config.mcpServers['slack-permissions'].env.SLACK_THREAD_TS).toBe('1234.5678');
  });

  it('should use defaults when no context provided', () => {
    const cmd = buildSlackClaudeCommand('/test/dir', 'hello');
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['slack-permissions'].env.SLACK_CHANNEL_ID).toBe('unknown');
    expect(config.mcpServers['slack-permissions'].env.SLACK_USER_ID).toBe('unknown');
  });

  it('should properly escape prompt with special characters', () => {
    const cmd = buildSlackClaudeCommand('/test/dir', "it's a test");
    expect(cmd).toContain("'it'\\''s a test'");
  });
});
