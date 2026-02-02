import { DiscordBot } from './bot/client.js';
import { ClaudeManager } from './claude/manager.js';
import { validateConfig, validateLineConfig } from './utils/config.js';
import { MCPPermissionServer } from './mcp/server.js';
import { LINEClaudeManager } from './line/manager.js';
import { LineBotHandler } from './line/bot.js';
import { LinePermissionManager } from './line/permission-manager.js';

async function main() {
  const config = validateConfig();
  const lineConfig = validateLineConfig();

  if (!config.discord && !lineConfig) {
    console.error('No platform configured. Set DISCORD_TOKEN + ALLOWED_USER_ID for Discord, or LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET for LINE.');
    process.exit(1);
  }

  // Start MCP Permission Server
  const mcpPort = parseInt(process.env.MCP_SERVER_PORT || '3001');
  const mcpServer = new MCPPermissionServer(mcpPort);

  console.log('Starting MCP Permission Server...');
  await mcpServer.start();

  // Optional: Discord Bot
  let bot: DiscordBot | undefined;
  let claudeManager: ClaudeManager | undefined;

  if (config.discord) {
    claudeManager = new ClaudeManager(config.baseFolder);
    bot = new DiscordBot(claudeManager, config.discord.allowedUserId);
    mcpServer.setDiscordBot(bot);
  }

  // Optional: LINE Bot
  let lineClaudeManager: LINEClaudeManager | undefined;

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

    try {
      await mcpServer.stop();
    } catch (error) {
      console.error('Error stopping MCP server:', error);
    }

    try {
      claudeManager?.destroy();
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

  if (bot && config.discord) {
    console.log('Starting Discord Bot...');
    await bot.login(config.discord.token);
    bot.setMCPServer(mcpServer);
  }

  console.log('All services started successfully!');
  if (config.discord) {
    console.log('Discord Bot is ready.');
  }
  if (lineConfig) {
    console.log('LINE Bot is ready. Set webhook URL to: https://<your-domain>:' + mcpPort + '/line/webhook');
  }
}

main().catch(console.error);
