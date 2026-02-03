import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { truncateWithSave, PLATFORM_LIMITS, type TruncateResult } from '../../src/shared/message-truncator';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('message-truncator', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    tempDir = path.join(os.tmpdir(), `truncator-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fs.mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('PLATFORM_LIMITS', () => {
    it('should have expected limit values', () => {
      expect(PLATFORM_LIMITS.discord).toBe(4000);
      expect(PLATFORM_LIMITS.slack).toBe(3800);
      expect(PLATFORM_LIMITS.line).toBe(1400);
      expect(PLATFORM_LIMITS.telegram).toBe(2900);
      expect(PLATFORM_LIMITS.email).toBe(5000);
      expect(PLATFORM_LIMITS.teams).toBe(900);
    });

    it('should include common platforms', () => {
      expect(PLATFORM_LIMITS).toHaveProperty('discord');
      expect(PLATFORM_LIMITS).toHaveProperty('slack');
      expect(PLATFORM_LIMITS).toHaveProperty('line');
      expect(PLATFORM_LIMITS).toHaveProperty('telegram');
    });
  });

  describe('truncateWithSave', () => {
    describe('short text (no truncation needed)', () => {
      it('should return original text when under limit', () => {
        const text = 'Short message';
        const result = truncateWithSave(text, 'discord', tempDir);

        expect(result.text).toBe(text);
        expect(result.wasTruncated).toBe(false);
        expect(result.savedPath).toBeUndefined();
      });

      it('should not create file when text is under limit', () => {
        const text = 'Short message';
        truncateWithSave(text, 'discord', tempDir);

        const resultPath = path.join(tempDir, '.claude-result.md');
        expect(fs.existsSync(resultPath)).toBe(false);
      });

      it('should handle text exactly at limit', () => {
        const text = 'a'.repeat(4000);
        const result = truncateWithSave(text, 'discord', tempDir);

        expect(result.text).toBe(text);
        expect(result.wasTruncated).toBe(false);
      });
    });

    describe('long text (truncation needed)', () => {
      it('should truncate text exceeding discord limit', () => {
        const text = 'a'.repeat(5000);
        const result = truncateWithSave(text, 'discord', tempDir);

        expect(result.text.length).toBeLessThanOrEqual(PLATFORM_LIMITS.discord);
        expect(result.wasTruncated).toBe(true);
        expect(result.savedPath).toBe('.claude-result.md');
      });

      it('should truncate text exceeding line limit', () => {
        const text = 'a'.repeat(2000);
        const result = truncateWithSave(text, 'line', tempDir);

        expect(result.text.length).toBeLessThanOrEqual(PLATFORM_LIMITS.line);
        expect(result.wasTruncated).toBe(true);
      });

      it('should include truncation notice in result', () => {
        const text = 'a'.repeat(5000);
        const result = truncateWithSave(text, 'discord', tempDir);

        expect(result.text).toContain('Response truncated');
        expect(result.text).toContain('.claude-result.md');
      });

      it('should save full text to .claude-result.md', () => {
        const text = 'a'.repeat(5000);
        truncateWithSave(text, 'discord', tempDir);

        const resultPath = path.join(tempDir, '.claude-result.md');
        expect(fs.existsSync(resultPath)).toBe(true);

        const savedContent = fs.readFileSync(resultPath, 'utf-8');
        expect(savedContent).toBe(text);
      });

      it('should preserve original text in saved file', () => {
        const originalText = 'This is a very long message. '.repeat(200);
        truncateWithSave(originalText, 'discord', tempDir);

        const resultPath = path.join(tempDir, '.claude-result.md');
        const savedContent = fs.readFileSync(resultPath, 'utf-8');

        expect(savedContent).toBe(originalText);
        expect(savedContent.length).toBeGreaterThan(PLATFORM_LIMITS.discord);
      });

      it('should handle different platform limits correctly', () => {
        const text = 'a'.repeat(5000);

        const discordResult = truncateWithSave(text, 'discord', tempDir);
        const lineResult = truncateWithSave(text, 'line', tempDir);
        const teamsResult = truncateWithSave(text, 'teams', tempDir);

        // Discord has higher limit than LINE
        expect(discordResult.text.length).toBeGreaterThan(lineResult.text.length);
        // LINE has higher limit than Teams
        expect(lineResult.text.length).toBeGreaterThan(teamsResult.text.length);
      });

      it('should account for truncation notice length', () => {
        const text = 'a'.repeat(5000);
        const result = truncateWithSave(text, 'discord', tempDir);

        // Total length should not exceed platform limit
        expect(result.text.length).toBeLessThanOrEqual(PLATFORM_LIMITS.discord);

        // Should end with truncation notice
        expect(result.text).toMatch(/Response truncated.*\.claude-result\.md$/);
      });
    });

    describe('unknown platform', () => {
      it('should not truncate for unknown platform', () => {
        const text = 'a'.repeat(10000);
        const result = truncateWithSave(text, 'unknown-platform', tempDir);

        expect(result.text).toBe(text);
        expect(result.wasTruncated).toBe(false);
      });
    });

    describe('file write errors', () => {
      it('should handle write errors gracefully', () => {
        const invalidDir = '/this/path/does/not/exist';
        const text = 'a'.repeat(5000);

        // Should not throw, but still return truncated text
        // The function logs the error but doesn't throw
        const result = truncateWithSave(text, 'discord', invalidDir);
        expect(result.wasTruncated).toBe(true);
        expect(result.text.length).toBeLessThanOrEqual(PLATFORM_LIMITS.discord);
      });
    });

    describe('edge cases', () => {
      it('should handle empty text', () => {
        const result = truncateWithSave('', 'discord', tempDir);

        expect(result.text).toBe('');
        expect(result.wasTruncated).toBe(false);
      });

      it('should handle text just over limit by 1 character', () => {
        const text = 'a'.repeat(4001);
        const result = truncateWithSave(text, 'discord', tempDir);

        expect(result.wasTruncated).toBe(true);
        expect(result.text.length).toBeLessThanOrEqual(PLATFORM_LIMITS.discord);
      });

      it('should handle multi-line text', () => {
        const text = 'line\n'.repeat(1000);
        const result = truncateWithSave(text, 'discord', tempDir);

        expect(result.wasTruncated).toBe(true);

        const savedPath = path.join(tempDir, '.claude-result.md');
        const savedContent = fs.readFileSync(savedPath, 'utf-8');
        expect(savedContent).toBe(text);
      });

      it('should handle unicode characters', () => {
        // Unicode emoji takes 4 bytes, so 2000 chars = 8000 bytes (exceeds Discord limit)
        const text = '🚀'.repeat(2000);
        const result = truncateWithSave(text, 'discord', tempDir);

        // Character count might be under limit even if byte count is over
        // This test verifies handling of unicode without assuming truncation
        expect(result.text.length).toBeLessThanOrEqual(text.length);

        if (result.wasTruncated) {
          expect(result.text.length).toBeLessThanOrEqual(PLATFORM_LIMITS.discord);
        }
      });

      it('should overwrite existing .claude-result.md file', () => {
        const resultPath = path.join(tempDir, '.claude-result.md');

        // Write initial file
        const text1 = 'a'.repeat(5000);
        truncateWithSave(text1, 'discord', tempDir);
        expect(fs.readFileSync(resultPath, 'utf-8')).toBe(text1);

        // Write new file (should overwrite)
        const text2 = 'b'.repeat(6000);
        truncateWithSave(text2, 'discord', tempDir);
        expect(fs.readFileSync(resultPath, 'utf-8')).toBe(text2);
      });
    });
  });
});
