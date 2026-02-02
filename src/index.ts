import { DiscordBot } from './bot/client.js';
import { ClaudeManager } from './claude/manager.js';
import { validateConfig, validateLineConfig } from './utils/config.js';
import { MCPPermissionServer } from './mcp/server.js';
import { LINEClaudeManager } from './line/manager.js';
import { LineBotHandler } from './line/bot.js';
import { LinePermissionManager } from './line/permission-manager.js';

async function main() {
  const config = validateConfig();
  
  // Start MCP Permission Server
  const mcpPort = parseInt(process.env.MCP_SERVER_PORT || '3001');
  const mcpServer = new MCPPermissionServer(mcpPort);
  
  console.log('Starting MCP Permission Server...');
  await mcpServer.start();
  
  // Start Discord Bot and Claude Manager
  const claudeManager = new ClaudeManager(config.baseFolder);
  const bot = new DiscordBot(claudeManager, config.allowedUserId);
  
  // Connect MCP server to Discord bot for interactive approvals
  mcpServer.setDiscordBot(bot);

  // Optional: LINE Bot initialization
  let lineClaudeManager: LINEClaudeManager | undefined;
  const lineConfig = validateLineConfig();
  if (lineConfig) {
    console.log('Initializing LINE Bot...');

    const linePermissionManager = new LinePermissionManager(lineConfig.channelAccessToken);
    lineClaudeManager = new LINEClaudeManager(config.baseFolder, lineConfig.channelAccessToken);
    const lineBotHandler = new LineBotHandler(
      lineConfig.channelSecret,
      lineConfig.channelAccessToken,
      lineConfig.allowedUserIds,
      lineClaudeManager,
      linePermissionManager,
      config.baseFolder,
    );

    mcpServer.setLinePermissionManager(linePermissionManager);
    mcpServer.registerLineRoutes(lineBotHandler);

    console.log('LINE Bot initialized. Webhook: /line/webhook');
  }

  // Handle graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');

    // Stop MCP server first
    try {
      await mcpServer.stop();
    } catch (error) {
      console.error('Error stopping MCP server:', error);
    }

    // Stop Claude managers
    try {
      claudeManager.destroy();
    } catch (error) {
      console.error('Error stopping Claude manager:', error);
    }

    try {
      lineClaudeManager?.destroy();
    } catch (error) {
      console.error('Error stopping LINE Claude manager:', error);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  
  console.log('Starting Discord Bot...');
  await bot.login(config.discordToken);
  
  // Expose MCP server to Discord bot for reaction handling
  bot.setMCPServer(mcpServer);
  
  console.log('All services started successfully!');
  console.log('MCP Server and Discord Bot are now connected for interactive approvals!');
  if (lineConfig) {
    console.log('LINE Bot is ready. Set webhook URL to: https://<your-domain>:3001/line/webhook');
  }
}

main().catch(console.error);