import { describe, it, expect } from 'vitest';
import { escapeShellString, buildClaudeCommand } from '../../../src/channel/discord/shell.js';

describe('escapeShellString', () => {
  it('should wrap simple strings in single quotes', () => {
    expect(escapeShellString('hello world')).toBe("'hello world'");
  });

  it('should escape single quotes properly', () => {
    expect(escapeShellString("don't")).toBe("'don'\\''t'");
  });

  it('should handle multiple single quotes', () => {
    expect(escapeShellString("can't won't")).toBe("'can'\\''t won'\\''t'");
  });

  it('should handle empty string', () => {
    expect(escapeShellString('')).toBe("''");
  });

  it('should handle string with only single quotes', () => {
    expect(escapeShellString("'''")).toBe("''\\'''\\'''\\'''");
  });
});

describe('buildClaudeCommand', () => {
  it('should build basic command without session ID', () => {
    const command = buildClaudeCommand('/test/dir', 'hello world');
    expect(command).toContain("cd /test/dir && claude --output-format stream-json --model sonnet -p 'hello world' --verbose");
    expect(command).toContain('--mcp-config');
    expect(command).toContain('--permission-prompt-tool mcp__discord-permissions__approve_tool');
  });

  it('should build command with session ID', () => {
    const command = buildClaudeCommand('/test/dir', 'hello world', 'session-123');
    expect(command).toContain('--resume session-123');
    expect(command).toContain("-p 'hello world'");
    expect(command).toContain('--mcp-config');
  });

  it('should properly escape prompt with special characters', () => {
    const command = buildClaudeCommand('/test/dir', "don't use this");
    expect(command).toContain("-p 'don'\\''t use this'");
  });

  it('should handle complex prompts', () => {
    const prompt = "Fix the bug in 'config.js' and don't break anything";
    const command = buildClaudeCommand('/project/path', prompt, 'abc-123');
    expect(command).toContain('--resume abc-123');
    expect(command).toContain("'Fix the bug in '\\''config.js'\\'' and don'\\''t break anything'");
  });
});
