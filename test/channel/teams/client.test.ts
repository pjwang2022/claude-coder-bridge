import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('botbuilder', () => ({
  BotFrameworkAdapter: vi.fn().mockImplementation(() => ({
    process: vi.fn(),
    continueConversation: vi.fn(),
    onTurnError: null,
  })),
  TurnContext: {
    getConversationReference: vi.fn().mockReturnValue({ conversation: { id: 'conv-1' } }),
  },
  ActivityHandler: class {
    onMessage(_handler: any) {}
    async run(_context: any) {}
  },
  CardFactory: {
    adaptiveCard: vi.fn((card: any) => ({ contentType: 'application/vnd.microsoft.card.adaptive', content: card })),
  },
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/db/database.js', () => ({
  DatabaseManager: vi.fn().mockImplementation(() => ({
    getSession: vi.fn(),
    setSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupOldTeamsTasks: vi.fn(),
    createTeamsTask: vi.fn().mockReturnValue(1),
    updateTeamsTaskStatus: vi.fn(),
    getLatestTeamsTask: vi.fn(),
    getRunningTeamsTasks: vi.fn().mockReturnValue([]),
    getTeamsUserProject: vi.fn(),
    setTeamsUserProject: vi.fn(),
    close: vi.fn(),
  })),
}));

import { TeamsBot } from '../../../src/channel/teams/client.js';
import type { TeamsConfig } from '../../../src/channel/teams/types.js';

describe('TeamsBot', () => {
  const config: TeamsConfig = {
    appId: 'test-app-id',
    appPassword: 'test-app-password',
    allowedUserIds: ['user-1'],
  };

  const mockClaudeManager = {
    setAdapter: vi.fn(),
    storeConversationReference: vi.fn(),
    hasActiveProcess: vi.fn().mockReturnValue(false),
    getUserProject: vi.fn().mockReturnValue('my-app'),
    setUserProject: vi.fn(),
    runTask: vi.fn().mockResolvedValue(1),
    clearSession: vi.fn(),
    getLatestTask: vi.fn(),
    getRunningTasks: vi.fn().mockReturnValue([]),
    destroy: vi.fn(),
  };

  const mockPermissionManager = {
    setAdapter: vi.fn(),
    storeConversationReference: vi.fn(),
    handleCardAction: vi.fn(),
    requestApproval: vi.fn(),
    cleanup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with adapter', () => {
      const bot = new TeamsBot(
        config,
        mockClaudeManager as any,
        mockPermissionManager as any,
        '/test/base',
      );
      expect(bot).toBeDefined();
      expect(bot.adapter).toBeDefined();
    });
  });

  describe('registerRoutes', () => {
    it('should register POST /teams/messages route', () => {
      const bot = new TeamsBot(
        config,
        mockClaudeManager as any,
        mockPermissionManager as any,
        '/test/base',
      );

      const mockApp = {
        post: vi.fn(),
      };

      bot.registerRoutes(mockApp as any);
      expect(mockApp.post).toHaveBeenCalledWith('/teams/messages', expect.any(Function));
    });
  });
});
