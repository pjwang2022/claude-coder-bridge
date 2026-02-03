import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock telegraf
vi.mock('telegraf', () => ({
  Telegraf: vi.fn().mockImplementation(() => ({
    command: vi.fn(),
    on: vi.fn(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    telegram: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      editMessageText: vi.fn().mockResolvedValue({}),
      getFileLink: vi.fn().mockResolvedValue({ href: 'https://example.com/file' }),
    },
  })),
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/db/database.js', () => ({
  DatabaseManager: vi.fn().mockImplementation(() => ({
    getTelegramUserProject: vi.fn(),
    setTelegramUserProject: vi.fn(),
    getLatestTelegramTask: vi.fn(),
    getRunningTelegramTasks: vi.fn(),
    getSession: vi.fn(),
    setSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupOldTelegramTasks: vi.fn(),
    close: vi.fn(),
  })),
}));

import { TelegramBot } from '../../../src/channel/telegram/client.js';
import type { TelegramConfig } from '../../../src/channel/telegram/types.js';

describe('TelegramBot', () => {
  let bot: TelegramBot;
  const config: TelegramConfig = {
    botToken: '123456:ABC-test-token',
    allowedUserIds: [123456789],
  };

  const mockClaudeManager = {
    hasActiveProcess: vi.fn().mockReturnValue(false),
    clearSession: vi.fn(),
    setBot: vi.fn(),
    runTask: vi.fn().mockResolvedValue(1),
    destroy: vi.fn(),
  };

  const mockPermissionManager = {
    setBot: vi.fn(),
    handleCallbackQuery: vi.fn(),
    requestApproval: vi.fn(),
    cleanup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    bot = new TelegramBot(config, mockClaudeManager as any, mockPermissionManager as any, '/test/base');
  });

  describe('constructor', () => {
    it('should create instance without throwing', () => {
      expect(() => new TelegramBot(config, mockClaudeManager as any, mockPermissionManager as any, '/test/base')).not.toThrow();
    });

    it('should expose bot for client access', () => {
      expect(bot.bot).toBeDefined();
      expect(bot.bot.telegram).toBeDefined();
    });
  });

  describe('start/stop', () => {
    it('should call bot.launch', async () => {
      await bot.start();
      expect(bot.bot.launch).toHaveBeenCalled();
    });

    it('should call bot.stop', async () => {
      await bot.stop();
      expect(bot.bot.stop).toHaveBeenCalledWith('SIGTERM');
    });
  });

  describe('handler registration', () => {
    it('should register all command handlers', () => {
      const commandCalls = (bot.bot.command as any).mock.calls;
      const registeredCommands = commandCalls.map((call: any[]) => call[0]);
      expect(registeredCommands).toContain('start');
      expect(registeredCommands).toContain('project');
      expect(registeredCommands).toContain('result');
      expect(registeredCommands).toContain('status');
      expect(registeredCommands).toContain('clear');
      expect(registeredCommands).toContain('help');
    });

    it('should register callback_query, photo, voice, and text handlers', () => {
      const onCalls = (bot.bot.on as any).mock.calls;
      const registeredEvents = onCalls.map((call: any[]) => call[0]);
      expect(registeredEvents).toContain('callback_query');
      expect(registeredEvents).toContain('photo');
      expect(registeredEvents).toContain('voice');
      expect(registeredEvents).toContain('text');
    });
  });
});
