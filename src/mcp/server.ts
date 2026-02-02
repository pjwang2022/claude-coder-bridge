import express from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { PermissionManager } from './permission-manager.js';
import type { LinePermissionManager } from '../line/permission-manager.js';

export class MCPPermissionServer {
  private app: express.Application;
  private port: number;
  private server?: any;
  private permissionManager: PermissionManager;
  private linePermissionManager?: LinePermissionManager;

  constructor(port: number = 3001) {
    this.port = port;
    this.app = express();
    this.app.use(express.json());
    this.permissionManager = new PermissionManager();
    
    this.setupRoutes();
  }

  /**
   * Set the Discord bot instance for the permission manager
   */
  setDiscordBot(discordBot: any): void {
    this.permissionManager.setDiscordBot(discordBot);
  }

  /**
   * Get the permission manager instance
   */
  getPermissionManager(): PermissionManager {
    return this.permissionManager;
  }

  /**
   * Extract Discord context from HTTP headers
   */
  private extractDiscordContext(req: any): any {
    const channelId = req.headers['x-discord-channel-id'];
    const channelName = req.headers['x-discord-channel-name'];
    const userId = req.headers['x-discord-user-id'];
    const messageId = req.headers['x-discord-message-id'];
    
    if (channelId) {
      return {
        channelId: channelId,
        channelName: channelName || 'unknown',
        userId: userId || 'unknown',
        messageId: messageId,
      };
    }
    
    return undefined;
  }

  private setupRoutes(): void {
    // Handle MCP requests (stateless mode)
    this.app.post('/mcp', async (req, res) => {
      try {
        console.log('MCP request received:', req.body);
        console.log('MCP request headers:', {
          'x-discord-channel-id': req.headers['x-discord-channel-id'],
          'x-discord-channel-name': req.headers['x-discord-channel-name'],
          'x-discord-user-id': req.headers['x-discord-user-id'],
          'x-discord-message-id': req.headers['x-discord-message-id'],
        });
        
        // Extract Discord context from headers
        const discordContextFromHeaders = this.extractDiscordContext(req);
        
        // Create new MCP server instance for each request (stateless)
        const mcpServer = new McpServer({
          name: 'Claude Code Permission Server',
          version: '1.0.0',
        });

        // Add the approval tool
        mcpServer.tool(
          'approve_tool',
          {
            tool_name: z.string().describe('The tool requesting permission'),
            input: z.object({}).passthrough().describe('The input for the tool'),
            discord_context: z.object({
              channelId: z.string(),
              channelName: z.string(),
              userId: z.string(),
              messageId: z.string().optional(),
            }).optional().describe('Discord context for permission decision'),
          },
          async ({ tool_name, input, discord_context }) => {
            console.log('MCP Server: Permission request received:', { tool_name, input, discord_context });
            
            // Use discord_context from parameters, or fall back to headers
            let effectiveDiscordContext = discord_context || discordContextFromHeaders;
            
            console.log('MCP Server: Effective Discord context:', effectiveDiscordContext);
            
            try {
              const decision = await this.permissionManager.requestApproval(tool_name, input, effectiveDiscordContext);
              
              console.log('MCP Server: Permission decision:', decision);
              
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(decision),
                  },
                ],
              };
            } catch (error) {
              console.error('MCP Server: Error processing permission request:', error);
              
              // Return deny on error for security
              const errorDecision = {
                behavior: 'deny',
                message: `Permission request failed: ${error instanceof Error ? error.message : String(error)}`,
              };
              
              return {
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify(errorDecision),
                  },
                ],
              };
            }
          }
        );

        // Create transport for this request
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless
        });

        // Clean up when request closes
        res.on('close', () => {
          console.log('MCP request closed');
          transport.close();
          mcpServer.close();
        });

        // Connect server to transport
        await mcpServer.connect(transport);
        
        // Handle the request
        await transport.handleRequest(req, res, req.body);
      } catch (error) {
        console.error('Error handling MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message: 'Internal server error',
            },
            id: null,
          });
        }
      }
    });

    // Handle GET requests (method not allowed for stateless mode)
    this.app.get('/mcp', (req, res) => {
      console.log('Received GET MCP request');
      res.status(405).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed - this server operates in stateless mode',
        },
        id: null,
      });
    });

    // Handle DELETE requests (method not allowed for stateless mode)
    this.app.delete('/mcp', (req, res) => {
      console.log('Received DELETE MCP request');
      res.status(405).json({
        jsonrpc: '2.0',
        error: {
          code: -32000,
          message: 'Method not allowed - this server operates in stateless mode',
        },
        id: null,
      });
    });

    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        server: 'Claude Code Permission Server',
        version: '1.0.0',
        port: this.port 
      });
    });
  }

  // --- LINE Integration (additive) ---

  setLinePermissionManager(linePermissionManager: LinePermissionManager): void {
    this.linePermissionManager = linePermissionManager;
  }

  registerLineRoutes(lineBotHandler: any): void {
    // LINE webhook endpoint
    this.app.post('/line/webhook', (req, res) => lineBotHandler.handleWebhook(req, res));

    // LINE MCP permission endpoint (mirrors /mcp but for LINE context)
    this.app.post('/line/mcp', async (req, res) => {
      try {
        const lineUserId = req.headers['x-line-user-id'] as string | undefined;
        const lineProjectName = req.headers['x-line-project-name'] as string | undefined;

        const lineContext = lineUserId
          ? { userId: lineUserId, projectName: lineProjectName || 'unknown' }
          : undefined;

        const mcpServer = new McpServer({
          name: 'Claude Code LINE Permission Server',
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
              if (!this.linePermissionManager) {
                return {
                  content: [{ type: 'text' as const, text: JSON.stringify({ behavior: 'deny', message: 'LINE permission manager not initialized' }) }],
                };
              }

              const decision = await this.linePermissionManager.requestApproval(tool_name, input, lineContext);
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(decision) }],
              };
            } catch (error) {
              return {
                content: [{ type: 'text' as const, text: JSON.stringify({ behavior: 'deny', message: `Permission error: ${error instanceof Error ? error.message : String(error)}` }) }],
              };
            }
          }
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
        console.error('Error handling LINE MCP request:', error);
        if (!res.headersSent) {
          res.status(500).json({
            jsonrpc: '2.0',
            error: { code: -32603, message: 'Internal server error' },
            id: null,
          });
        }
      }
    });

    console.log('LINE routes registered: /line/webhook, /line/mcp');
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
    // Clean up permission managers
    this.permissionManager.cleanup();
    this.linePermissionManager?.cleanup();

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