import { describe, it, expect, afterEach } from 'vitest';
import { buildWebUIClaudeCommand } from '../../../src/channel/webui/shell.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('buildWebUIClaudeCommand', () => {
  afterEach(() => {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith('mcp-config-webui-') && file.endsWith('.json')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  });

  it('should build basic command without session ID', () => {
    const cmd = buildWebUIClaudeCommand('/test/dir', 'hello');
    expect(cmd).toContain('cd /test/dir');
    expect(cmd).toContain('claude');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain("'hello'");
    expect(cmd).toContain('--permission-prompt-tool mcp__webui-permissions__approve_tool');
    expect(cmd).toContain('--allowedTools mcp__webui-permissions');
    expect(cmd).not.toContain('--resume');
  });

  it('should build command with session ID', () => {
    const cmd = buildWebUIClaudeCommand('/test/dir', 'hello', 'session-123');
    expect(cmd).toContain('--resume session-123');
  });

  it('should create MCP config with webui platform', () => {
    const context = {
      connectionId: 'conn-abc',
      project: 'my-app',
    };

    const cmd = buildWebUIClaudeCommand('/test/dir', 'hello', undefined, context);
    expect(cmd).toContain('--mcp-config');

    const match = cmd.match(/--mcp-config\s+(\S+)/);
    expect(match).toBeTruthy();
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['webui-permissions']).toBeDefined();
    expect(config.mcpServers['webui-permissions'].env.PLATFORM).toBe('webui');
    expect(config.mcpServers['webui-permissions'].env.WEBUI_CONNECTION_ID).toBe('conn-abc');
    expect(config.mcpServers['webui-permissions'].env.WEBUI_PROJECT).toBe('my-app');
  });

  it('should use defaults when no context provided', () => {
    const cmd = buildWebUIClaudeCommand('/test/dir', 'hello');
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['webui-permissions'].env.WEBUI_CONNECTION_ID).toBe('unknown');
    expect(config.mcpServers['webui-permissions'].env.WEBUI_PROJECT).toBe('unknown');
  });

  it('should properly escape prompt with special characters', () => {
    const cmd = buildWebUIClaudeCommand('/test/dir', "it's a test");
    expect(cmd).toContain("'it'\\''s a test'");
  });
});
