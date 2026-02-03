import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @slack/bolt
vi.mock('@slack/bolt', () => ({
  App: vi.fn().mockImplementation(() => ({
    event: vi.fn(),
    command: vi.fn(),
    client: {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'msg-ts-001' }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      conversations: {
        info: vi.fn().mockResolvedValue({ channel: { name: 'test-channel' } }),
      },
      reactions: {
        add: vi.fn().mockResolvedValue({}),
      },
    },
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/db/database.js', () => ({
  DatabaseManager: vi.fn().mockImplementation(() => ({
    getSession: vi.fn(),
    setSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupOldSessions: vi.fn(),
    close: vi.fn(),
  })),
}));

import { SlackBot } from '../../../src/channel/slack/client.js';
import type { SlackConfig } from '../../../src/channel/slack/types.js';

describe('SlackBot', () => {
  let bot: SlackBot;
  const config: SlackConfig = {
    botToken: 'xoxb-test-token',
    appToken: 'xapp-test-token',
    signingSecret: 'test-signing-secret',
    allowedUserIds: ['U123'],
  };

  const mockClaudeManager = {
    hasActiveProcess: vi.fn().mockReturnValue(false),
    clearSession: vi.fn(),
    setSlackClient: vi.fn(),
    reserveChannel: vi.fn(),
    runClaudeCode: vi.fn().mockResolvedValue(undefined),
    getSessionId: vi.fn().mockReturnValue(undefined),
    killActiveProcess: vi.fn(),
    destroy: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    bot = new SlackBot(config, mockClaudeManager as any, '/test/base');
  });

  describe('constructor', () => {
    it('should create instance without throwing', () => {
      expect(() => new SlackBot(config, mockClaudeManager as any, '/test/base')).not.toThrow();
    });

    it('should expose app for client access', () => {
      expect(bot.app).toBeDefined();
      expect(bot.app.client).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should call app.start', async () => {
      await bot.start();
      expect(bot.app.start).toHaveBeenCalled();
    });

    it('should call app.stop', async () => {
      await bot.stop();
      expect(bot.app.stop).toHaveBeenCalled();
    });
  });

  describe('event handlers setup', () => {
    it('should register message and reaction events', () => {
      expect(bot.app.event).toHaveBeenCalledWith('message', expect.any(Function));
      expect(bot.app.event).toHaveBeenCalledWith('reaction_added', expect.any(Function));
    });

    it('should register /clear command', () => {
      expect(bot.app.command).toHaveBeenCalledWith('/clear', expect.any(Function));
    });
  });
});
