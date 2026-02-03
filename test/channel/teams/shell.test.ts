import { describe, it, expect, afterEach } from 'vitest';
import { buildTeamsClaudeCommand } from '../../../src/channel/teams/shell.js';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('buildTeamsClaudeCommand', () => {
  afterEach(() => {
    const tmpDir = os.tmpdir();
    const files = fs.readdirSync(tmpDir);
    for (const file of files) {
      if (file.startsWith('mcp-config-teams-') && file.endsWith('.json')) {
        fs.unlinkSync(path.join(tmpDir, file));
      }
    }
  });

  it('should build basic command without session ID', () => {
    const cmd = buildTeamsClaudeCommand('/test/dir', 'hello');
    expect(cmd).toContain('cd /test/dir');
    expect(cmd).toContain('claude');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain("'hello'");
    expect(cmd).toContain('--permission-prompt-tool mcp__teams-permissions__approve_tool');
    expect(cmd).toContain('--allowedTools mcp__teams-permissions');
    expect(cmd).not.toContain('--resume');
  });

  it('should build command with session ID', () => {
    const cmd = buildTeamsClaudeCommand('/test/dir', 'hello', 'session-123');
    expect(cmd).toContain('--resume session-123');
  });

  it('should create MCP config with teams platform', () => {
    const context = {
      userId: 'user-aad-123',
      conversationId: 'conv-456',
      serviceUrl: 'https://smba.trafficmanager.net/teams/',
      projectName: 'my-app',
    };

    const cmd = buildTeamsClaudeCommand('/test/dir', 'hello', undefined, context);
    expect(cmd).toContain('--mcp-config');

    const match = cmd.match(/--mcp-config\s+(\S+)/);
    expect(match).toBeTruthy();
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['teams-permissions']).toBeDefined();
    expect(config.mcpServers['teams-permissions'].env.PLATFORM).toBe('teams');
    expect(config.mcpServers['teams-permissions'].env.TEAMS_USER_ID).toBe('user-aad-123');
    expect(config.mcpServers['teams-permissions'].env.TEAMS_CONVERSATION_ID).toBe('conv-456');
    expect(config.mcpServers['teams-permissions'].env.TEAMS_SERVICE_URL).toBe('https://smba.trafficmanager.net/teams/');
    expect(config.mcpServers['teams-permissions'].env.TEAMS_PROJECT_NAME).toBe('my-app');
  });

  it('should use defaults when no context provided', () => {
    const cmd = buildTeamsClaudeCommand('/test/dir', 'hello');
    const match = cmd.match(/--mcp-config\s+(\S+)/);
    const configPath = match![1];
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    expect(config.mcpServers['teams-permissions'].env.TEAMS_USER_ID).toBe('unknown');
    expect(config.mcpServers['teams-permissions'].env.TEAMS_PROJECT_NAME).toBe('unknown');
  });

  it('should properly escape prompt with special characters', () => {
    const cmd = buildTeamsClaudeCommand('/test/dir', "it's a test");
    expect(cmd).toContain("'it'\\''s a test'");
  });
});
