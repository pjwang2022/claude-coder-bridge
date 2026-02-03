import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as crypto from 'crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Server } from 'http';
import type { Application } from 'express';
import type { WebUIConfig } from './types.js';
import type { WebUIClaudeManager } from './manager.js';
import type { WebUIPermissionManager } from './permission-manager.js';
import {
  buildAuthResultPayload,
  buildProjectListPayload,
  buildSessionListPayload,
  buildChatHistoryPayload,
  buildErrorPayload,
  buildBusyPayload,
} from './messages.js';
import { validateFile } from '../../shared/file-validator.js';
import { saveAttachment, buildAttachmentPrompt } from '../../shared/attachments.js';
import { transcribeAudio } from '../../shared/speechmatics.js';

interface Connection {
  ws: WebSocket;
  connectionId: string;
  authenticated: boolean;
  project?: string;
}

export class WebUIServer {
  private wss?: WebSocketServer;
  private connections = new Map<string, Connection>();
  private config: WebUIConfig;
  private claudeManager: WebUIClaudeManager;
  private permissionManager: WebUIPermissionManager;
  private baseFolder: string;

  constructor(
    config: WebUIConfig,
    claudeManager: WebUIClaudeManager,
    permissionManager: WebUIPermissionManager,
    baseFolder: string,
  ) {
    this.config = config;
    this.claudeManager = claudeManager;
    this.permissionManager = permissionManager;
    this.baseFolder = baseFolder;

    // Wire up send functions
    const sendFn = this.sendToConnection.bind(this);
    this.claudeManager.setSendFunction(sendFn);
    this.permissionManager.setSendFunction(sendFn);
  }

  registerRoutes(app: Application): void {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const htmlPath = path.join(currentDir, 'public', 'index.html');

    app.get('/', (_req, res) => {
      if (fs.existsSync(htmlPath)) {
        res.sendFile(htmlPath);
      } else {
        res.status(404).send('Web UI not found');
      }
    });
  }

  attachToServer(httpServer: Server): void {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });

    this.wss.on('connection', (ws) => {
      const connectionId = crypto.randomUUID();
      const conn: Connection = {
        ws,
        connectionId,
        authenticated: !this.config.password, // Auto-auth if no password
      };
      this.connections.set(connectionId, conn);

      console.log(`WebUI: New connection ${connectionId} (auth=${conn.authenticated})`);

      if (conn.authenticated) {
        this.sendJson(ws, buildAuthResultPayload(true));
        this.sendProjectList(ws);
      } else {
        this.sendJson(ws, { type: 'auth_required' });
      }

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(connectionId, msg);
        } catch (err) {
          console.error(`WebUI: Invalid message from ${connectionId}:`, err);
        }
      });

      ws.on('close', () => {
        console.log(`WebUI: Connection closed ${connectionId}`);
        this.claudeManager.disconnectConnection(connectionId);
        this.connections.delete(connectionId);
      });

      ws.on('error', (err) => {
        console.error(`WebUI: WebSocket error ${connectionId}:`, err);
        this.connections.delete(connectionId);
      });
    });

    console.log('WebUI: WebSocket server attached at /ws');
  }

  private handleMessage(connectionId: string, msg: any): void {
    const conn = this.connections.get(connectionId);
    if (!conn) return;

    switch (msg.type) {
      case 'auth':
        this.handleAuth(conn, msg);
        break;
      case 'prompt':
        this.handlePrompt(conn, msg).catch(err => {
          console.error('WebUI: Error in handlePrompt:', err);
          this.sendJson(conn.ws, buildErrorPayload(err.message));
        });
        break;
      case 'approval_response':
        this.handleApprovalResponse(conn, msg);
        break;
      case 'clear_session':
        this.handleClearSession(conn, msg);
        break;
      case 'load_history':
        this.handleLoadHistory(conn, msg);
        break;
      case 'create_project':
        this.handleCreateProject(conn, msg);
        break;
      case 'list_sessions':
        this.handleListSessions(conn, msg);
        break;
      case 'create_session':
        this.handleCreateSession(conn, msg);
        break;
      case 'delete_session':
        this.handleDeleteSession(conn, msg);
        break;
      case 'rename_session':
        this.handleRenameSession(conn, msg);
        break;
      default:
        this.sendJson(conn.ws, buildErrorPayload(`Unknown message type: ${msg.type}`));
    }
  }

  private handleAuth(conn: Connection, msg: any): void {
    if (!this.config.password) {
      conn.authenticated = true;
      this.sendJson(conn.ws, buildAuthResultPayload(true));
      this.sendProjectList(conn.ws);
      return;
    }

    if (msg.password === this.config.password) {
      conn.authenticated = true;
      this.sendJson(conn.ws, buildAuthResultPayload(true));
      this.sendProjectList(conn.ws);
    } else {
      this.sendJson(conn.ws, buildAuthResultPayload(false, 'Invalid password'));
    }
  }

  private async handlePrompt(conn: Connection, msg: any): Promise<void> {
    if (!conn.authenticated) {
      this.sendJson(conn.ws, buildErrorPayload('Not authenticated'));
      return;
    }

    const project = msg.project;
    const text = msg.text || '';
    const files: Array<{ name: string; data: string; size: number }> = msg.files || [];

    if (!project || (!text && files.length === 0)) {
      this.sendJson(conn.ws, buildErrorPayload('Missing project or content'));
      return;
    }

    const sessionName = msg.sessionName || 'default';
    conn.project = project;

    if (this.claudeManager.hasActiveProcess(conn.connectionId, project, sessionName)) {
      this.sendJson(conn.ws, { ...buildBusyPayload(project, sessionName), sessionName });
      return;
    }

    let prompt = text;

    // Process file attachments
    if (files.length > 0) {
      const workingDir = path.join(this.baseFolder, project);
      const savedPaths: string[] = [];

      for (const file of files) {
        const validation = validateFile(file.name, file.size || 0);
        if (!validation.allowed) continue;

        try {
          const buffer = Buffer.from(file.data, 'base64');

          if (validation.category === 'audio') {
            const apiKey = process.env.SPEECHMATICS_API_KEY;
            if (apiKey) {
              const language = process.env.SPEECHMATICS_LANGUAGE || 'cmn';
              const transcribed = await transcribeAudio(apiKey, buffer, file.name, language);
              if (transcribed.trim()) {
                prompt = transcribed + (prompt ? `\n\n${prompt}` : '');
              }
            }
          } else {
            savedPaths.push(saveAttachment(workingDir, file.name, buffer));
          }
        } catch (error) {
          console.error(`WebUI: Error processing file ${file.name}:`, error);
        }
      }

      if (savedPaths.length > 0) {
        prompt += buildAttachmentPrompt(savedPaths);
      }
    }

    if (!prompt) {
      this.sendJson(conn.ws, buildErrorPayload('No content to process'));
      return;
    }

    this.claudeManager.runClaudeCode(conn.connectionId, project, prompt, sessionName)
      .catch((err) => {
        console.error(`WebUI: Error running Claude Code:`, err);
        this.sendJson(conn.ws, buildErrorPayload(err.message));
      });
  }

  private handleApprovalResponse(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const { requestId, approved } = msg;
    if (!requestId || typeof approved !== 'boolean') return;

    this.permissionManager.handleApprovalResponse(requestId, approved);
  }

  private handleLoadHistory(conn: Connection, msg: any): void {
    if (!conn.authenticated) {
      this.sendJson(conn.ws, buildErrorPayload('Not authenticated'));
      return;
    }

    const project = msg.project;
    if (!project) {
      this.sendJson(conn.ws, buildErrorPayload('Missing project'));
      return;
    }

    const sessionName = msg.sessionName || 'default';
    const limit = Math.min(msg.limit || 10, 50);
    const beforeId = msg.beforeId;

    const messages = this.claudeManager.getChatHistory(project, limit, beforeId, sessionName);
    const hasMore = messages.length === limit;

    this.sendJson(conn.ws, { ...buildChatHistoryPayload(messages, hasMore), sessionName });
  }

  private handleCreateProject(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const name = msg.name?.trim();
    if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) {
      this.sendJson(conn.ws, buildErrorPayload('Invalid project name. Use only letters, numbers, hyphens, and underscores.'));
      return;
    }

    const projectPath = path.join(this.baseFolder, name);
    if (fs.existsSync(projectPath)) {
      this.sendJson(conn.ws, buildErrorPayload(`Project "${name}" already exists.`));
      return;
    }

    fs.mkdirSync(projectPath, { recursive: true });
    console.log(`WebUI: Created project directory: ${projectPath}`);
    this.sendProjectList(conn.ws);
  }

  private handleClearSession(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const project = msg.project;
    if (!project) return;

    const sessionName = msg.sessionName || 'default';
    this.claudeManager.clearSession(conn.connectionId, project, sessionName);
    this.sendJson(conn.ws, { type: 'session_cleared', project, sessionName });
  }

  private handleListSessions(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const project = msg.project;
    if (!project) {
      this.sendJson(conn.ws, buildErrorPayload('Missing project'));
      return;
    }

    const sessions = this.claudeManager.getSessions(project);
    this.sendJson(conn.ws, buildSessionListPayload(sessions));
  }

  private handleCreateSession(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const project = msg.project;
    const sessionName = msg.sessionName?.trim();
    if (!project || !sessionName) {
      this.sendJson(conn.ws, buildErrorPayload('Missing project or session name'));
      return;
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(sessionName)) {
      this.sendJson(conn.ws, buildErrorPayload('Invalid session name. Use only letters, numbers, hyphens, and underscores.'));
      return;
    }

    this.claudeManager.createSession(project, sessionName);
    const sessions = this.claudeManager.getSessions(project);
    this.sendJson(conn.ws, buildSessionListPayload(sessions));
  }

  private handleDeleteSession(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const project = msg.project;
    const sessionName = msg.sessionName;
    if (!project || !sessionName) {
      this.sendJson(conn.ws, buildErrorPayload('Missing project or session name'));
      return;
    }

    this.claudeManager.deleteSession(project, sessionName);
    const sessions = this.claudeManager.getSessions(project);
    this.sendJson(conn.ws, buildSessionListPayload(sessions));
  }

  private handleRenameSession(conn: Connection, msg: any): void {
    if (!conn.authenticated) return;

    const project = msg.project;
    const sessionName = msg.sessionName;
    const displayName = msg.displayName?.trim();
    if (!project || !sessionName || !displayName) {
      this.sendJson(conn.ws, buildErrorPayload('Missing project, session name, or display name'));
      return;
    }

    this.claudeManager.renameSession(project, sessionName, displayName);
    const sessions = this.claudeManager.getSessions(project);
    this.sendJson(conn.ws, buildSessionListPayload(sessions));
  }

  private sendProjectList(ws: WebSocket): void {
    try {
      const entries = fs.readdirSync(this.baseFolder, { withFileTypes: true });
      const projects = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort();
      this.sendJson(ws, buildProjectListPayload(projects));
    } catch (err) {
      console.error('WebUI: Error reading project list:', err);
    }
  }

  private sendToConnection(connectionId: string, payload: any): void {
    const conn = this.connections.get(connectionId);
    if (conn && conn.ws.readyState === conn.ws.OPEN) {
      this.sendJson(conn.ws, payload);
    }
  }

  private sendJson(ws: WebSocket, data: any): void {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  stop(): void {
    for (const [, conn] of this.connections) {
      conn.ws.close();
    }
    this.connections.clear();
    this.wss?.close();
  }
}
