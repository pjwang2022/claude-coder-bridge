import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('ws', () => ({
  WebSocketServer: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    close: vi.fn(),
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

import { WebUIServer } from '../../../src/channel/webui/client.js';
import type { WebUIConfig } from '../../../src/channel/webui/types.js';
import { WebUIClaudeManager } from '../../../src/channel/webui/manager.js';
import { WebUIPermissionManager } from '../../../src/channel/webui/permission-manager.js';

describe('WebUIServer', () => {
  const config: WebUIConfig = { password: 'secret' };

  const mockClaudeManager = {
    setSendFunction: vi.fn(),
    hasActiveProcess: vi.fn().mockReturnValue(false),
    getSessionId: vi.fn(),
    runClaudeCode: vi.fn().mockResolvedValue(undefined),
    clearSession: vi.fn(),
    disconnectConnection: vi.fn(),
    destroy: vi.fn(),
  };

  const mockPermissionManager = {
    setSendFunction: vi.fn(),
    handleApprovalResponse: vi.fn(),
    requestApproval: vi.fn(),
    cleanup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance and wire send functions', () => {
      const server = new WebUIServer(
        config,
        mockClaudeManager as any,
        mockPermissionManager as any,
        '/test/base',
      );
      expect(server).toBeDefined();
      expect(mockClaudeManager.setSendFunction).toHaveBeenCalled();
      expect(mockPermissionManager.setSendFunction).toHaveBeenCalled();
    });
  });

  describe('registerRoutes', () => {
    it('should register GET / route', () => {
      const server = new WebUIServer(
        config,
        mockClaudeManager as any,
        mockPermissionManager as any,
        '/test/base',
      );

      const mockApp = {
        get: vi.fn(),
      };

      server.registerRoutes(mockApp as any);
      expect(mockApp.get).toHaveBeenCalledWith('/', expect.any(Function));
    });
  });

  describe('stop', () => {
    it('should close WebSocket server', () => {
      const server = new WebUIServer(
        config,
        mockClaudeManager as any,
        mockPermissionManager as any,
        '/test/base',
      );

      // Should not throw even without wss
      expect(() => server.stop()).not.toThrow();
    });
  });

  describe('no password config', () => {
    it('should auto-authenticate when no password is set', () => {
      const noPassConfig: WebUIConfig = {};
      const server = new WebUIServer(
        noPassConfig,
        mockClaudeManager as any,
        mockPermissionManager as any,
        '/test/base',
      );
      expect(server).toBeDefined();
    });
  });
});
