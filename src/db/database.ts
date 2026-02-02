import { Database } from "bun:sqlite";
import * as path from "path";
import type { LineTaskResult, LineUserProject, TaskStatus } from "../line/types.js";

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
  }

  getSession(channelId: string): string | undefined {
    const stmt = this.db.query("SELECT session_id FROM channel_sessions WHERE channel_id = ?");
    const result = stmt.get(channelId) as { session_id: string } | null;
    return result?.session_id;
  }

  setSession(channelId: string, sessionId: string, channelName: string): void {
    const stmt = this.db.query(`
      INSERT OR REPLACE INTO channel_sessions (channel_id, session_id, channel_name, last_used)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(channelId, sessionId, channelName, Date.now());
  }

  clearSession(channelId: string): void {
    const stmt = this.db.query("DELETE FROM channel_sessions WHERE channel_id = ?");
    stmt.run(channelId);
  }

  getAllSessions(): ChannelSession[] {
    const stmt = this.db.query("SELECT * FROM channel_sessions ORDER BY last_used DESC");
    return stmt.all() as ChannelSession[];
  }

  // Clean up old sessions (older than 30 days)
  cleanupOldSessions(): void {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const stmt = this.db.query("DELETE FROM channel_sessions WHERE last_used < ?");
    const result = stmt.run(thirtyDaysAgo);
    if (result.changes > 0) {
      console.log(`Cleaned up ${result.changes} old sessions`);
    }
  }

  close(): void {
    this.db.close();
  }

  // --- LINE: User Project Management ---

  getLineUserProject(userId: string): string | undefined {
    const stmt = this.db.query("SELECT project_name FROM line_user_projects WHERE user_id = ?");
    const result = stmt.get(userId) as { project_name: string } | null;
    return result?.project_name;
  }

  setLineUserProject(userId: string, projectName: string): void {
    const stmt = this.db.query(`
      INSERT OR REPLACE INTO line_user_projects (user_id, project_name, updated_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(userId, projectName, Date.now());
  }

  deleteLineUserProject(userId: string): void {
    const stmt = this.db.query("DELETE FROM line_user_projects WHERE user_id = ?");
    stmt.run(userId);
  }

  // --- LINE: Task Results ---

  createLineTask(userId: string, projectName: string, prompt: string): number {
    const stmt = this.db.query(`
      INSERT INTO line_task_results (user_id, project_name, status, prompt, created_at)
      VALUES (?, ?, 'running', ?, ?)
    `);
    const result = stmt.run(userId, projectName, prompt, Date.now());
    return Number(result.lastInsertRowid);
  }

  updateLineTaskStatus(taskId: number, status: TaskStatus, result?: string, sessionId?: string): void {
    const completedAt = status === 'completed' || status === 'failed' ? Date.now() : null;
    const stmt = this.db.query(`
      UPDATE line_task_results
      SET status = ?, result = COALESCE(?, result), session_id = COALESCE(?, session_id), completed_at = COALESCE(?, completed_at)
      WHERE id = ?
    `);
    stmt.run(status, result ?? null, sessionId ?? null, completedAt, taskId);
  }

  getLineTask(taskId: number): LineTaskResult | undefined {
    const stmt = this.db.query("SELECT * FROM line_task_results WHERE id = ?");
    const row = stmt.get(taskId) as any;
    if (!row) return undefined;
    return this.mapLineTaskRow(row);
  }

  getLatestLineTask(userId: string): LineTaskResult | undefined {
    const stmt = this.db.query(
      "SELECT * FROM line_task_results WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
    );
    const row = stmt.get(userId) as any;
    if (!row) return undefined;
    return this.mapLineTaskRow(row);
  }

  getRunningLineTasks(userId: string): LineTaskResult[] {
    const stmt = this.db.query(
      "SELECT * FROM line_task_results WHERE user_id = ? AND status = 'running' ORDER BY created_at DESC"
    );
    const rows = stmt.all(userId) as any[];
    return rows.map(row => this.mapLineTaskRow(row));
  }

  cleanupOldLineTasks(): void {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const stmt = this.db.query(
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
}