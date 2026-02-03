import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock better-sqlite3
const mockQuery = vi.fn();
const mockExec = vi.fn();
const mockClose = vi.fn();
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockAll = vi.fn();

vi.mock("better-sqlite3", () => ({
  default: vi.fn().mockImplementation(() => ({
    exec: mockExec,
    prepare: vi.fn(() => ({
      get: mockGet,
      run: mockRun,
      all: mockAll
    })),
    close: mockClose
  }))
}));

import { DatabaseManager } from "../../src/db/database.js";

describe("DatabaseManager", () => {
  let db: DatabaseManager;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new DatabaseManager("/test/path.db");
  });

  afterEach(() => {
    db.close();
  });

  describe("initialization", () => {
    it("should create tables on initialization", () => {
      expect(mockExec).toHaveBeenCalledWith(expect.stringContaining("CREATE TABLE IF NOT EXISTS channel_sessions"));
    });
  });

  describe("session management", () => {
    it("should return undefined for non-existent session", () => {
      mockGet.mockReturnValue(null);
      
      const result = db.getSession("non-existent-channel");
      
      expect(result).toBeUndefined();
      expect(mockGet).toHaveBeenCalledWith("non-existent-channel");
    });

    it("should return session ID when it exists", () => {
      mockGet.mockReturnValue({ session_id: "session-123" });
      
      const result = db.getSession("channel-1");
      
      expect(result).toBe("session-123");
      expect(mockGet).toHaveBeenCalledWith("channel-1");
    });

    it("should store a session", () => {
      const channelId = "test-channel-123";
      const sessionId = "session-456";
      const channelName = "test-channel";

      db.setSession(channelId, sessionId, channelName);

      expect(mockRun).toHaveBeenCalledWith(
        channelId,
        sessionId,
        channelName,
        expect.any(Number)
      );
    });

    it("should clear a session", () => {
      const channelId = "test-channel-123";

      db.clearSession(channelId);

      expect(mockRun).toHaveBeenCalledWith(channelId);
    });
  });

  describe("getAllSessions", () => {
    it("should return all sessions", () => {
      const mockSessions = [
        { channel_id: "channel-1", session_id: "session-1", channel_name: "channel-one", last_used: 123456 },
        { channel_id: "channel-2", session_id: "session-2", channel_name: "channel-two", last_used: 123457 },
      ];
      mockAll.mockReturnValue(mockSessions);

      const result = db.getAllSessions();

      expect(result).toEqual(mockSessions);
      expect(mockAll).toHaveBeenCalled();
    });
  });

  describe("cleanupOldSessions", () => {
    it("should remove old sessions", () => {
      mockRun.mockReturnValue({ changes: 2 });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      db.cleanupOldSessions();

      expect(mockRun).toHaveBeenCalledWith(expect.any(Number));
      expect(consoleSpy).toHaveBeenCalledWith("Cleaned up 2 old sessions");
      
      consoleSpy.mockRestore();
    });

    it("should not log when no sessions are cleaned", () => {
      mockRun.mockReturnValue({ changes: 0 });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      db.cleanupOldSessions();

      expect(mockRun).toHaveBeenCalledWith(expect.any(Number));
      expect(consoleSpy).not.toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe("close", () => {
    it("should close the database", () => {
      db.close();
      expect(mockClose).toHaveBeenCalled();
    });
  });
});