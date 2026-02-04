import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { PermissionManager } from '../channel/discord/permission-manager.js';
import type { LinePermissionManager } from '../channel/line/permission-manager.js';
import type { SlackPermissionManager } from '../channel/slack/permission-manager.js';
import type { TelegramPermissionManager } from '../channel/telegram/permission-manager.js';
import type { EmailPermissionManager } from '../channel/email/permission-manager.js';
import type { WebUIPermissionManager } from '../channel/webui/permission-manager.js';
import type { PermissionDecision } from '../shared/permissions.js';

export class MCPPermissionServer {
  private app: express.Application;
  private port: number;
  private server?: any;
  private permissionManager: PermissionManager;
  private linePermissionManager?: LinePermissionManager;
  private slackPermissionManager?: SlackPermissionManager;
  private telegramPermissionManager?: TelegramPermissionManager;
  private emailPermissionManager?: EmailPermissionManager;
  private webUIPermissionManager?: WebUIPermissionManager;

  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.permissionManager = new PermissionManager();

    this.setupRoutes();
  }

  setDiscordBot(discordBot: any): void {
    this.permissionManager.setDiscordBot(discordBot);
  }

  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  private extractDiscordContext(req: express.Request): any | undefined {
    const channelId = req.headers['x-discord-channel-id'];
    if (channelId) {
      return {
        channelId,
        channelName: req.headers['x-discord-channel-name'] || 'unknown',
        userId: req.headers['x-discord-user-id'] || 'unknown',
        messageId: req.headers['x-discord-message-id'],
      };
    }
    return undefined;
  }

  private extractLineContext(req: express.Request): any | undefined {
    const userId = req.headers['x-line-user-id'] as string | undefined;
    if (userId) {
      return {
        userId,
        projectName: (req.headers['x-line-project-name'] as string) || 'unknown',
      };
    }
    return undefined;
  }

  private createMcpHandler(
    serverName: string,
    extractContext: (req: express.Request) => any | undefined,
    resolveApproval: (toolName: string, input: any, context: any | undefined) => Promise<PermissionDecision>,
  ): express.RequestHandler {
    return async (req: express.Request, res: express.Response) => {
      try {
        const context = extractContext(req);

        const mcpServer = new McpServer({
          name: serverName,
          version: '1.0.0',
        });

        mcpServer.tool(
          'approve_tool',
          {
            tool_name: z.string().describe('The tool requesting permission'),
            input: z.object({}).passthrough().describe('The input for the tool'),
          },
          async ({ tool_name, input }) => {
            try {
              const decision = await resolveApproval(tool_name, input, context);
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(decision) }],
              };
            } catch (error) {
              return {
                content: [{
                  type: 'text' as const,
                  text: JSON.stringify({
                    behavior: 'deny',
                    message: `Permission error: ${error instanceof Error ? error.message : String(error)}`,
                  }),
                }],
              };
            }
          },
        );

        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
        });

        res.on('close', () => {
          transport.close();
          mcpServer.close();
        });

        await mcpServer.connect(transport);
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error(`Error handling MCP request (${serverName}):`, error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    };
  }

  private setupRoutes(): void {
    // Discord MCP permission endpoint
    this.app.post('/mcp', this.createMcpHandler(
      'Claude Code Permission Server',
      (req) => this.extractDiscordContext(req),
      (toolName, input, context) => this.permissionManager.requestApproval(toolName, input, context),
    ));

    // GET/DELETE not allowed for stateless mode
    this.app.get('/mcp', (_req, res) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed - this server operates in stateless mode' },
        id: null,
      });
    });

    this.app.delete('/mcp', (_req, res) => {
      res.status(405).json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed - this server operates in stateless mode' },
        id: null,
      });
    });

    // Health check
    this.app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        server: 'Claude Code Permission Server',
        version: '1.0.0',
        port: this.port,
      });
    });
  }

  // --- Slack Integration ---

  setSlackPermissionManager(slackPermissionManager: SlackPermissionManager): void {
    this.slackPermissionManager = slackPermissionManager;
  }

  registerSlackMcpRoute(slackPermissionManager: SlackPermissionManager): void {
    this.app.post('/slack/mcp', this.createMcpHandler(
      'Claude Code Slack Permission Server',
      (req) => this.extractSlackContext(req),
      (toolName, input, context) => {
        if (!slackPermissionManager) {
          return Promise.resolve({ behavior: 'deny' as const, message: 'Slack permission manager not initialized' });
        }
        return slackPermissionManager.requestApproval(toolName, input, context);
      },
    ));

    console.log('Slack MCP route registered: /slack/mcp');
  }

  private extractSlackContext(req: express.Request): any | undefined {
    const channelId = req.headers['x-slack-channel-id'] as string | undefined;
    if (channelId) {
      return {
        channelId,
        channelName: req.headers['x-slack-channel-name'] || 'unknown',
        userId: req.headers['x-slack-user-id'] || 'unknown',
        threadTs: req.headers['x-slack-thread-ts'],
      };
    }
    return undefined;
  }

  // --- Telegram Integration ---

  setTelegramPermissionManager(telegramPermissionManager: TelegramPermissionManager): void {
    this.telegramPermissionManager = telegramPermissionManager;
  }

  registerTelegramMcpRoute(telegramPermissionManager: TelegramPermissionManager): void {
    this.app.post('/telegram/mcp', this.createMcpHandler(
      'Claude Code Telegram Permission Server',
      (req) => this.extractTelegramContext(req),
      (toolName, input, context) => {
        if (!telegramPermissionManager) {
          return Promise.resolve({ behavior: 'deny' as const, message: 'Telegram permission manager not initialized' });
        }
        return telegramPermissionManager.requestApproval(toolName, input, context);
      },
    ));

    console.log('Telegram MCP route registered: /telegram/mcp');
  }

  private extractTelegramContext(req: express.Request): any | undefined {
    const userId = req.headers['x-telegram-user-id'] as string | undefined;
    if (userId) {
      return {
        userId: parseInt(userId) || 0,
        chatId: parseInt(req.headers['x-telegram-chat-id'] as string) || 0,
        projectName: (req.headers['x-telegram-project-name'] as string) || 'unknown',
      };
    }
    return undefined;
  }

  // --- Email Integration ---

  setEmailPermissionManager(emailPermissionManager: EmailPermissionManager): void {
    this.emailPermissionManager = emailPermissionManager;
  }

  registerEmailMcpRoute(emailPermissionManager: EmailPermissionManager): void {
    this.app.post('/email/mcp', this.createMcpHandler(
      'Claude Code Email Permission Server',
      (req) => this.extractEmailContext(req),
      (toolName, input, context) => {
        if (!emailPermissionManager) {
          return Promise.resolve({ behavior: 'deny' as const, message: 'Email permission manager not initialized' });
        }
        return emailPermissionManager.requestApproval(toolName, input, context);
      },
    ));

    // Approval HTTP routes (for clickable links in emails)
    this.app.get('/email/approve', (req: express.Request, res: express.Response) => {
      this.handleEmailApproval(req, res, true);
    });

    this.app.get('/email/deny', (req: express.Request, res: express.Response) => {
      this.handleEmailApproval(req, res, false);
    });

    console.log('Email MCP route registered: /email/mcp, /email/approve, /email/deny');
  }

  private handleEmailApproval(req: express.Request, res: express.Response, approved: boolean): void {
    const requestId = req.query.requestId as string;
    const token = req.query.token as string;

    if (!requestId || !token || !this.emailPermissionManager) {
      res.status(400).send(this.approvalHtmlPage('Error', 'Invalid or missing parameters.'));
      return;
    }

    const result = this.emailPermissionManager.handleApprovalHttp(requestId, token, approved);
    const title = result.success ? (approved ? 'Approved' : 'Denied') : 'Error';
    res.status(result.success ? 200 : 400).send(this.approvalHtmlPage(title, result.message));
  }

  private approvalHtmlPage(title: string, message: string): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5;">
<div style="text-align:center;padding:40px;background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
<h1>${title}</h1><p>${message}</p><p style="color:#999;font-size:14px;">You can close this tab.</p>
</div></body></html>`;
  }

  private extractEmailContext(req: express.Request): any | undefined {
    const from = req.headers['x-email-from'] as string | undefined;
    if (from) {
      return {
        from,
        subject: '',
        projectName: (req.headers['x-email-project-name'] as string) || 'unknown',
        messageId: (req.headers['x-email-message-id'] as string) || '',
      };
    }
    return undefined;
  }

  // --- WebUI Integration ---

  setWebUIPermissionManager(webUIPermissionManager: WebUIPermissionManager): void {
    this.webUIPermissionManager = webUIPermissionManager;
  }

  registerWebUIMcpRoute(webUIPermissionManager: WebUIPermissionManager): void {
    this.app.post('/webui/mcp', this.createMcpHandler(
      'Claude Code WebUI Permission Server',
      (req) => this.extractWebUIContext(req),
      (toolName, input, context) => {
        if (!webUIPermissionManager) {
          return Promise.resolve({ behavior: 'deny' as const, message: 'WebUI permission manager not initialized' });
        }
        return webUIPermissionManager.requestApproval(toolName, input, context);
      },
    ));

    console.log('WebUI MCP route registered: /webui/mcp');
  }

  private extractWebUIContext(req: express.Request): any | undefined {
    const connectionId = req.headers['x-webui-connection-id'] as string | undefined;
    if (connectionId) {
      return {
        connectionId,
        project: (req.headers['x-webui-project'] as string) || 'unknown',
      };
    }
    return undefined;
  }

  // --- LINE Integration ---

  setLinePermissionManager(linePermissionManager: LinePermissionManager): void {
    this.linePermissionManager = linePermissionManager;
  }

  registerLineRoutes(lineBotHandler: any): void {
    this.app.post('/line/webhook', (req, res) => lineBotHandler.handleWebhook(req, res));

    this.app.post('/line/mcp', this.createMcpHandler(
      'Claude Code LINE Permission Server',
      (req) => this.extractLineContext(req),
      (toolName, input, context) => {
        if (!this.linePermissionManager) {
          return Promise.resolve({ behavior: 'deny' as const, message: 'LINE permission manager not initialized' });
        }
        return this.linePermissionManager.requestApproval(toolName, input, context);
      },
    ));

    console.log('LINE routes registered: /line/webhook, /line/mcp');
  }

  getExpressApp(): express.Application {
    return this.app;
  }

  getHttpServer(): any {
    return this.server;
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err);
        } else {
          console.log(`MCP Permission Server listening on port ${this.port}`);
          console.log(`Health check: http://localhost:${this.port}/health`);
          console.log(`MCP endpoint: http://localhost:${this.port}/mcp`);
          resolve();
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.permissionManager.cleanup();
    this.linePermissionManager?.cleanup();
    this.slackPermissionManager?.cleanup();
    this.telegramPermissionManager?.cleanup();
    this.emailPermissionManager?.cleanup();
    this.webUIPermissionManager?.cleanup();

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          console.log('MCP Permission Server stopped');
          resolve();
        });
      });
    }
  }
}
