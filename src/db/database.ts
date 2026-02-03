import Database from "better-sqlite3";
import * as path from "path";
import type { LineTaskResult, LineUserProject, TaskStatus } from "../channel/line/types.js";
import type { TelegramTaskResult, TaskStatus as TelegramTaskStatus } from "../channel/telegram/types.js";
import type { EmailTaskResult, TaskStatus as EmailTaskStatus } from "../channel/email/types.js";
import type { TeamsTaskResult, TaskStatus as TeamsTaskStatus } from "../channel/teams/types.js";

export interface WebUIChatMessage {
  id: number;
  project: string;
  sessionName: string;
  role: string;
  content: string;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface WebUISession {
  id: number;
  project: string;
  sessionName: string;
  displayName: string;
  claudeSessionId?: string;
  createdAt: number;
  lastUsed: number;
}

export interface ChannelSession {
  channelId: string;
  sessionId: string;
  channelName: string;
  lastUsed: number;
}

export class DatabaseManager {
  private db: Database;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), "sessions.db");
    this.db = new Database(finalPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    // Create sessions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS channel_sessions (
        channel_id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        channel_name TEXT NOT NULL,
        last_used INTEGER NOT NULL
      )
    `);

    // LINE: user project selection
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS line_user_projects (
        user_id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // LINE: task results for async retrieval
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS line_task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        result TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_line_task_results_user_status
      ON line_task_results(user_id, status)
    `);

    // Telegram: user project selection
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_user_projects (
        user_id INTEGER PRIMARY KEY,
        project_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Telegram: task results for async retrieval
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS telegram_task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        project_name TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        result TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_telegram_task_results_user_status
      ON telegram_task_results(user_id, status)
    `);

    // Email: task results for async retrieval
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS email_task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        project_name TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        result TEXT,
        message_id TEXT,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_email_task_results_user_status
      ON email_task_results(user_email, status)
    `);

    // Teams: user project selection
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams_user_projects (
        user_id TEXT PRIMARY KEY,
        project_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Teams: task results for async retrieval
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teams_task_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        project_name TEXT NOT NULL,
        session_id TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        prompt TEXT NOT NULL,
        result TEXT,
        conversation_id TEXT NOT NULL,
        service_url TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        completed_at INTEGER
      )
    `);

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_teams_task_results_user_status
      ON teams_task_results(user_id, status)
    `);

    // WebUI: sessions per project
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webui_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        session_name TEXT NOT NULL,
        claude_session_id TEXT,
        created_at INTEGER NOT NULL,
        last_used INTEGER NOT NULL,
        UNIQUE(project, session_name)
      )
    `);

    // WebUI: chat message history
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webui_chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        session_name TEXT NOT NULL DEFAULT 'default',
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // Migration: add session_name column if table existed before multi-session support
    try {
      this.db.exec(`ALTER TABLE webui_chat_messages ADD COLUMN session_name TEXT NOT NULL DEFAULT 'default'`);
    } catch {
      // Column already exists — ignore
    }

    // Migration: add display_name column to webui_sessions
    try {
      this.db.exec(`ALTER TABLE webui_sessions ADD COLUMN display_name TEXT`);
      this.db.exec(`UPDATE webui_sessions SET display_name = session_name WHERE display_name IS NULL`);
    } catch {
      // Column already exists — ignore
    }

    // Drop old index and create new session-aware index
    this.db.exec(`DROP INDEX IF EXISTS idx_webui_chat_messages_project`);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_webui_chat_messages_project_session
      ON webui_chat_messages(project, session_name, id DESC)
    `);
  }

  getSession(channelId: string): string | undefined {
    const stmt = this.db.prepare("SELECT session_id FROM channel_sessions WHERE channel_id = ?");
    const result = stmt.get(channelId) as { session_id: string } | null;
    return result?.session_id;
  }

  setSession(channelId: string, sessionId: string, channelName: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO channel_sessions (channel_id, session_id, channel_name, last_used)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(channelId, sessionId, channelName, Date.now());
  }

  clearSession(channelId: string): void {
    const stmt = this.db.prepare("DELETE FROM channel_sessions WHERE channel_id = ?");
    stmt.run(channelId);
  }

  getAllSessions(): ChannelSession[] {
    const stmt = this.db.prepare("SELECT * FROM channel_sessions ORDER BY last_used DESC");
    return stmt.all() as ChannelSession[];
  }

  // Clean up old sessions (configurable via SESSION_CLEANUP_DAYS, default 7)
  cleanupOldSessions(): void {
    const cleanupDays = parseInt(process.env.SESSION_CLEANUP_DAYS || '7');
    const cutoff = Date.now() - (cleanupDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare("DELETE FROM channel_sessions WHERE last_used < ?");
    const result = stmt.run(cutoff);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old sessions`);
    }
  }

  close(): void {
    this.db.close();
  }

  // --- WebUI: Sessions ---

  getWebUISessions(project: string): WebUISession[] {
    const stmt = this.db.prepare(
      "SELECT * FROM webui_sessions WHERE project = ? ORDER BY last_used DESC"
    );
    const rows = stmt.all(project) as any[];
    return rows.map(row => ({
      id: row.id,
      project: row.project,
      sessionName: row.session_name,
      displayName: row.display_name || row.session_name,
      claudeSessionId: row.claude_session_id || undefined,
      createdAt: row.created_at,
      lastUsed: row.last_used,
    }));
  }

  createWebUISession(project: string, sessionName: string, displayName?: string): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO webui_sessions (project, session_name, display_name, created_at, last_used)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(project, sessionName, displayName || sessionName, now, now);
  }

  renameWebUISession(project: string, sessionName: string, displayName: string): void {
    const stmt = this.db.prepare(
      "UPDATE webui_sessions SET display_name = ? WHERE project = ? AND session_name = ?"
    );
    stmt.run(displayName, project, sessionName);
  }

  deleteWebUISession(project: string, sessionName: string): void {
    const stmt = this.db.prepare(
      "DELETE FROM webui_sessions WHERE project = ? AND session_name = ?"
    );
    stmt.run(project, sessionName);
    this.clearWebUIChatMessages(project, sessionName);
  }

  getWebUISessionClaudeId(project: string, sessionName: string): string | undefined {
    const stmt = this.db.prepare(
      "SELECT claude_session_id FROM webui_sessions WHERE project = ? AND session_name = ?"
    );
    const result = stmt.get(project, sessionName) as { claude_session_id: string } | null;
    return result?.claude_session_id || undefined;
  }

  setWebUISessionClaudeId(project: string, sessionName: string, claudeSessionId: string): void {
    const stmt = this.db.prepare(`
      UPDATE webui_sessions SET claude_session_id = ?, last_used = ? WHERE project = ? AND session_name = ?
    `);
    stmt.run(claudeSessionId, Date.now(), project, sessionName);
  }

  // --- WebUI: Chat Messages ---

  saveWebUIChatMessage(project: string, role: string, content: string, metadata?: string, sessionName: string = 'default'): number {
    const stmt = this.db.prepare(`
      INSERT INTO webui_chat_messages (project, session_name, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(project, sessionName, role, content, metadata ?? null, Date.now());
    return Number(result.lastInsertRowid);
  }

  getWebUIChatMessages(project: string, limit: number, beforeId?: number, sessionName: string = 'default'): WebUIChatMessage[] {
    let rows: any[];
    if (beforeId) {
      const stmt = this.db.prepare(
        "SELECT * FROM webui_chat_messages WHERE project = ? AND session_name = ? AND id < ? ORDER BY id DESC LIMIT ?"
      );
      rows = stmt.all(project, sessionName, beforeId, limit) as any[];
    } else {
      const stmt = this.db.prepare(
        "SELECT * FROM webui_chat_messages WHERE project = ? AND session_name = ? ORDER BY id DESC LIMIT ?"
      );
      rows = stmt.all(project, sessionName, limit) as any[];
    }
    return rows.map(row => this.mapWebUIChatMessageRow(row)).reverse();
  }

  clearWebUIChatMessages(project: string, sessionName?: string): void {
    if (sessionName) {
      const stmt = this.db.prepare("DELETE FROM webui_chat_messages WHERE project = ? AND session_name = ?");
      stmt.run(project, sessionName);
    } else {
      const stmt = this.db.prepare("DELETE FROM webui_chat_messages WHERE project = ?");
      stmt.run(project);
    }
  }

  cleanupOldWebUIChatMessages(): void {
    const cleanupDays = parseInt(process.env.SESSION_CLEANUP_DAYS || '7');
    const cutoff = Date.now() - (cleanupDays * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare("DELETE FROM webui_chat_messages WHERE created_at < ?");
    const result = stmt.run(cutoff);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old WebUI chat messages`);
    }
    // Also clean up old sessions
    const stmtSessions = this.db.prepare("DELETE FROM webui_sessions WHERE last_used < ?");
    const resultSessions = stmtSessions.run(cutoff);
    if (resultSessions.changes > 0) {
      console.log(`Cleaned up ${resultSessions.changes} old WebUI sessions`);
    }
  }

  private mapWebUIChatMessageRow(row: any): WebUIChatMessage {
    return {
      id: row.id,
      project: row.project,
      sessionName: row.session_name,
      role: row.role,
      content: row.content,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
    };
  }

  // --- LINE: User Project Management ---

  getLineUserProject(userId: string): string | undefined {
    const stmt = this.db.prepare("SELECT project_name FROM line_user_projects WHERE user_id = ?");
    const result = stmt.get(userId) as { project_name: string } | null;
    return result?.project_name;
  }

  setLineUserProject(userId: string, projectName: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO line_user_projects (user_id, project_name, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(userId, projectName, Date.now());
  }

  deleteLineUserProject(userId: string): void {
    const stmt = this.db.prepare("DELETE FROM line_user_projects WHERE user_id = ?");
    stmt.run(userId);
  }

  // --- LINE: Task Results ---

  createLineTask(userId: string, projectName: string, prompt: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO line_task_results (user_id, project_name, status, prompt, created_at)
      VALUES (?, ?, 'running', ?, ?)
    `);
    const result = stmt.run(userId, projectName, prompt, Date.now());
    return Number(result.lastInsertRowid);
  }

  updateLineTaskStatus(taskId: number, status: TaskStatus, result?: string, sessionId?: string): void {
    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;
    const stmt = this.db.prepare(`
      UPDATE line_task_results
      SET status = ?, result = COALESCE(?, result), session_id = COALESCE(?, session_id), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `);
    stmt.run(status, result ?? null, sessionId ?? null, completedAt, taskId);
  }

  getLineTask(taskId: number): LineTaskResult | undefined {
    const stmt = this.db.prepare("SELECT * FROM line_task_results WHERE id = ?");
    const row = stmt.get(taskId) as any;
    if (!row) return undefined;
    return this.mapLineTaskRow(row);
  }

  getLatestLineTask(userId: string): LineTaskResult | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM line_task_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    );
    const row = stmt.get(userId) as any;
    if (!row) return undefined;
    return this.mapLineTaskRow(row);
  }

  getRunningLineTasks(userId: string): LineTaskResult[] {
    const stmt = this.db.prepare(
      "SELECT * FROM line_task_results WHERE user_id = ? AND status = 'running' ORDER BY created_at DESC"
    );
    const rows = stmt.all(userId) as any[];
    return rows.map(row => this.mapLineTaskRow(row));
  }

  cleanupOldLineTasks(): void {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(
      "DELETE FROM line_task_results WHERE status != 'running' AND created_at < ?"
    );
    const result = stmt.run(sevenDaysAgo);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old LINE tasks`);
    }
  }

  private mapLineTaskRow(row: any): LineTaskResult {
    return {
      id: row.id,
      userId: row.user_id,
      projectName: row.project_name,
      sessionId: row.session_id,
      status: row.status,
      prompt: row.prompt,
      result: row.result,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  // --- Telegram: User Project Management ---

  getTelegramUserProject(userId: number): string | undefined {
    const stmt = this.db.prepare("SELECT project_name FROM telegram_user_projects WHERE user_id = ?");
    const result = stmt.get(userId) as { project_name: string } | null;
    return result?.project_name;
  }

  setTelegramUserProject(userId: number, projectName: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO telegram_user_projects (user_id, project_name, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(userId, projectName, Date.now());
  }

  deleteTelegramUserProject(userId: number): void {
    const stmt = this.db.prepare("DELETE FROM telegram_user_projects WHERE user_id = ?");
    stmt.run(userId);
  }

  // --- Telegram: Task Results ---

  createTelegramTask(userId: number, projectName: string, prompt: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO telegram_task_results (user_id, project_name, status, prompt, created_at)
      VALUES (?, ?, 'running', ?, ?)
    `);
    const result = stmt.run(userId, projectName, prompt, Date.now());
    return Number(result.lastInsertRowid);
  }

  updateTelegramTaskStatus(taskId: number, status: TelegramTaskStatus, result?: string, sessionId?: string): void {
    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;
    const stmt = this.db.prepare(`
      UPDATE telegram_task_results
      SET status = ?, result = COALESCE(?, result), session_id = COALESCE(?, session_id), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `);
    stmt.run(status, result ?? null, sessionId ?? null, completedAt, taskId);
  }

  getLatestTelegramTask(userId: number): TelegramTaskResult | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM telegram_task_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    );
    const row = stmt.get(userId) as any;
    if (!row) return undefined;
    return this.mapTelegramTaskRow(row);
  }

  getRunningTelegramTasks(userId: number): TelegramTaskResult[] {
    const stmt = this.db.prepare(
      "SELECT * FROM telegram_task_results WHERE user_id = ? AND status = 'running' ORDER BY created_at DESC"
    );
    const rows = stmt.all(userId) as any[];
    return rows.map(row => this.mapTelegramTaskRow(row));
  }

  cleanupOldTelegramTasks(): void {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(
      "DELETE FROM telegram_task_results WHERE status != 'running' AND created_at < ?"
    );
    const result = stmt.run(sevenDaysAgo);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old Telegram tasks`);
    }
  }

  private mapTelegramTaskRow(row: any): TelegramTaskResult {
    return {
      id: row.id,
      userId: row.user_id,
      projectName: row.project_name,
      sessionId: row.session_id,
      status: row.status,
      prompt: row.prompt,
      result: row.result,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  // --- Email: Task Results ---

  createEmailTask(userEmail: string, projectName: string, prompt: string, messageId: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO email_task_results (user_email, project_name, status, prompt, message_id, created_at)
      VALUES (?, ?, 'running', ?, ?, ?)
    `);
    const result = stmt.run(userEmail, projectName, prompt, messageId, Date.now());
    return Number(result.lastInsertRowid);
  }

  updateEmailTaskStatus(taskId: number, status: EmailTaskStatus, result?: string, sessionId?: string): void {
    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;
    const stmt = this.db.prepare(`
      UPDATE email_task_results
      SET status = ?, result = COALESCE(?, result), session_id = COALESCE(?, session_id), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `);
    stmt.run(status, result ?? null, sessionId ?? null, completedAt, taskId);
  }

  getEmailTask(taskId: number): EmailTaskResult | undefined {
    const stmt = this.db.prepare("SELECT * FROM email_task_results WHERE id = ?");
    const row = stmt.get(taskId) as any;
    if (!row) return undefined;
    return this.mapEmailTaskRow(row);
  }

  getLatestEmailTask(userEmail: string): EmailTaskResult | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM email_task_results WHERE user_email = ? ORDER BY created_at DESC LIMIT 1"
    );
    const row = stmt.get(userEmail) as any;
    if (!row) return undefined;
    return this.mapEmailTaskRow(row);
  }

  getRunningEmailTasks(userEmail: string): EmailTaskResult[] {
    const stmt = this.db.prepare(
      "SELECT * FROM email_task_results WHERE user_email = ? AND status = 'running' ORDER BY created_at DESC"
    );
    const rows = stmt.all(userEmail) as any[];
    return rows.map(row => this.mapEmailTaskRow(row));
  }

  cleanupOldEmailTasks(): void {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(
      "DELETE FROM email_task_results WHERE status != 'running' AND created_at < ?"
    );
    const result = stmt.run(sevenDaysAgo);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old Email tasks`);
    }
  }

  private mapEmailTaskRow(row: any): EmailTaskResult {
    return {
      id: row.id,
      userEmail: row.user_email,
      projectName: row.project_name,
      sessionId: row.session_id,
      status: row.status,
      prompt: row.prompt,
      result: row.result,
      messageId: row.message_id,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }

  // --- Teams: User Project Management ---

  getTeamsUserProject(userId: string): string | undefined {
    const stmt = this.db.prepare("SELECT project_name FROM teams_user_projects WHERE user_id = ?");
    const result = stmt.get(userId) as { project_name: string } | null;
    return result?.project_name;
  }

  setTeamsUserProject(userId: string, projectName: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO teams_user_projects (user_id, project_name, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(userId, projectName, Date.now());
  }

  deleteTeamsUserProject(userId: string): void {
    const stmt = this.db.prepare("DELETE FROM teams_user_projects WHERE user_id = ?");
    stmt.run(userId);
  }

  // --- Teams: Task Results ---

  createTeamsTask(userId: string, projectName: string, prompt: string, conversationId: string, serviceUrl: string): number {
    const stmt = this.db.prepare(`
      INSERT INTO teams_task_results (user_id, project_name, status, prompt, conversation_id, service_url, created_at)
      VALUES (?, ?, 'running', ?, ?, ?, ?)
    `);
    const result = stmt.run(userId, projectName, prompt, conversationId, serviceUrl, Date.now());
    return Number(result.lastInsertRowid);
  }

  updateTeamsTaskStatus(taskId: number, status: TeamsTaskStatus, result?: string, sessionId?: string): void {
    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;
    const stmt = this.db.prepare(`
      UPDATE teams_task_results
      SET status = ?, result = COALESCE(?, result), session_id = COALESCE(?, session_id), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `);
    stmt.run(status, result ?? null, sessionId ?? null, completedAt, taskId);
  }

  getLatestTeamsTask(userId: string): TeamsTaskResult | undefined {
    const stmt = this.db.prepare(
      "SELECT * FROM teams_task_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    );
    const row = stmt.get(userId) as any;
    if (!row) return undefined;
    return this.mapTeamsTaskRow(row);
  }

  getRunningTeamsTasks(userId: string): TeamsTaskResult[] {
    const stmt = this.db.prepare(
      "SELECT * FROM teams_task_results WHERE user_id = ? AND status = 'running' ORDER BY created_at DESC"
    );
    const rows = stmt.all(userId) as any[];
    return rows.map(row => this.mapTeamsTaskRow(row));
  }

  cleanupOldTeamsTasks(): void {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stmt = this.db.prepare(
      "DELETE FROM teams_task_results WHERE status != 'running' AND created_at < ?"
    );
    const result = stmt.run(sevenDaysAgo);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old Teams tasks`);
    }
  }

  private mapTeamsTaskRow(row: any): TeamsTaskResult {
    return {
      id: row.id,
      userId: row.user_id,
      projectName: row.project_name,
      sessionId: row.session_id,
      status: row.status,
      prompt: row.prompt,
      result: row.result,
      conversationId: row.conversation_id,
      serviceUrl: row.service_url,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  }
}