import 'dotenv/config';
import { DiscordBot } from './channel/discord/client.js';
import { ClaudeManager } from './channel/discord/manager.js';
import { validateConfig, validateLineConfig, validateSlackConfig, validateTelegramConfig, validateEmailConfig, validateWebUIConfig, logClaudeMode } from './utils/config.js';
import { MCPPermissionServer } from './mcp/server.js';
import { LINEClaudeManager } from './channel/line/manager.js';
import { LineBotHandler } from './channel/line/bot.js';
import { LinePermissionManager } from './channel/line/permission-manager.js';
import { SlackBot } from './channel/slack/client.js';
import { SlackClaudeManager } from './channel/slack/manager.js';
import { SlackPermissionManager } from './channel/slack/permission-manager.js';
import { TelegramBot } from './channel/telegram/client.js';
import { TelegramClaudeManager } from './channel/telegram/manager.js';
import { TelegramPermissionManager } from './channel/telegram/permission-manager.js';
import { EmailBot } from './channel/email/client.js';
import { EmailClaudeManager } from './channel/email/manager.js';
import { EmailPermissionManager } from './channel/email/permission-manager.js';
import { WebUIServer } from './channel/webui/client.js';
import { WebUIClaudeManager } from './channel/webui/manager.js';
import { WebUIPermissionManager } from './channel/webui/permission-manager.js';

async function main() {
  const config = validateConfig();
  const lineConfig = validateLineConfig();
  const slackConfig = validateSlackConfig();
  const telegramConfig = validateTelegramConfig();
  const emailConfig = validateEmailConfig();
  const webUIConfig = validateWebUIConfig();
  if (!config.discord && !lineConfig && !slackConfig && !telegramConfig && !emailConfig && !webUIConfig) {
    console.error('No platform configured. Set DISCORD_TOKEN + ALLOWED_USER_IDS for Discord, LINE_CHANNEL_ACCESS_TOKEN + LINE_CHANNEL_SECRET for LINE, SLACK_BOT_TOKEN + SLACK_APP_TOKEN + SLACK_SIGNING_SECRET for Slack, TELEGRAM_BOT_TOKEN for Telegram, EMAIL_USER + EMAIL_PASS for Email, or WEB_UI_ENABLED=true for Web UI.');
    process.exit(1);
  }

  // Log Claude mode configuration
  logClaudeMode();

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
    bot = new DiscordBot(claudeManager, config.discord.allowedUserIds, config.discord.allowedChannelIds, config.baseFolder);
    mcpServer.setDiscordBot(bot);
    // Set permission manager for API mode
    claudeManager.setPermissionManager(mcpServer.getPermissionManager());
  }

  // Optional: Slack Bot
  let slackBot: SlackBot | undefined;
  let slackClaudeManager: SlackClaudeManager | undefined;

  if (slackConfig) {
    console.log('Initializing Slack Bot...');

    const slackPermissionManager = new SlackPermissionManager();
    slackClaudeManager = new SlackClaudeManager(config.baseFolder);
    slackBot = new SlackBot(slackConfig, slackClaudeManager, config.baseFolder);
    slackBot.setPermissionManager(slackPermissionManager);
    slackClaudeManager.setSlackClient(slackBot.app.client);

    mcpServer.setSlackPermissionManager(slackPermissionManager);
    mcpServer.registerSlackMcpRoute(slackPermissionManager);

    console.log('Slack Bot initialized.');
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
      lineConfig.speechmaticsApiKey || '',
      lineConfig.speechmaticsLanguage,
    );

    mcpServer.setLinePermissionManager(linePermissionManager);
    mcpServer.registerLineRoutes(lineBotHandler);

    console.log('LINE Bot initialized. Webhook: /line/webhook');
  }

  // Optional: Telegram Bot
  let telegramBot: TelegramBot | undefined;
  let telegramClaudeManager: TelegramClaudeManager | undefined;

  if (telegramConfig) {
    console.log('Initializing Telegram Bot...');

    const telegramPermissionManager = new TelegramPermissionManager();
    telegramClaudeManager = new TelegramClaudeManager(config.baseFolder);
    telegramBot = new TelegramBot(telegramConfig, telegramClaudeManager, telegramPermissionManager, config.baseFolder);
    telegramPermissionManager.setBot(telegramBot.bot);
    telegramClaudeManager.setBot(telegramBot.bot);

    mcpServer.setTelegramPermissionManager(telegramPermissionManager);
    mcpServer.registerTelegramMcpRoute(telegramPermissionManager);

    console.log('Telegram Bot initialized.');
  }

  // Optional: Email Bot
  let emailBot: EmailBot | undefined;
  let emailClaudeManager: EmailClaudeManager | undefined;

  if (emailConfig) {
    console.log('Initializing Email Bot...');

    const emailPermissionManager = new EmailPermissionManager();
    emailClaudeManager = new EmailClaudeManager(config.baseFolder);
    emailBot = new EmailBot(emailConfig, emailClaudeManager, emailPermissionManager, config.baseFolder);
    emailPermissionManager.setTransporter(emailBot.transporter);
    emailPermissionManager.setBotEmail(emailConfig.emailUser);
    emailClaudeManager.setTransporter(emailBot.transporter);
    emailClaudeManager.setBotEmail(emailConfig.emailUser);

    mcpServer.setEmailPermissionManager(emailPermissionManager);
    mcpServer.registerEmailMcpRoute(emailPermissionManager);

    console.log('Email Bot initialized.');
  }

  // Optional: Web UI
  let webUIServer: WebUIServer | undefined;
  let webUIClaudeManager: WebUIClaudeManager | undefined;

  if (webUIConfig) {
    console.log('Initializing Web UI...');

    const webUIPermissionManager = new WebUIPermissionManager();
    webUIClaudeManager = new WebUIClaudeManager(config.baseFolder);
    webUIServer = new WebUIServer(webUIConfig, webUIClaudeManager, webUIPermissionManager, config.baseFolder);

    webUIServer.registerRoutes(mcpServer.getExpressApp());

    mcpServer.setWebUIPermissionManager(webUIPermissionManager);
    mcpServer.registerWebUIMcpRoute(webUIPermissionManager);

    console.log('Web UI initialized.');
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

    try {
      slackClaudeManager?.destroy();
    } catch (error) {
      console.error('Error stopping Slack Claude manager:', error);
    }

    try {
      await slackBot?.stop();
    } catch (error) {
      console.error('Error stopping Slack bot:', error);
    }

    try {
      telegramClaudeManager?.destroy();
    } catch (error) {
      console.error('Error stopping Telegram Claude manager:', error);
    }

    try {
      await telegramBot?.stop();
    } catch (error) {
      console.error('Error stopping Telegram bot:', error);
    }

    try {
      emailClaudeManager?.destroy();
    } catch (error) {
      console.error('Error stopping Email Claude manager:', error);
    }

    try {
      await emailBot?.stop();
    } catch (error) {
      console.error('Error stopping Email bot:', error);
    }

    try {
      webUIClaudeManager?.destroy();
      webUIServer?.stop();
    } catch (error) {
      console.error('Error stopping Web UI:', error);
    }

    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Attach WebUI WebSocket server before starting bots
  // (some bot .start() calls like Telegram's bot.launch() never resolve)
  if (webUIServer) {
    const httpServer = mcpServer.getHttpServer();
    if (httpServer) {
      webUIServer.attachToServer(httpServer);
      console.log(`Web UI available at: http://localhost:${mcpPort}/`);
    }
  }

  if (bot && config.discord) {
    console.log('Starting Discord Bot...');
    await bot.login(config.discord.token);
    bot.setMCPServer(mcpServer);
  }

  if (slackBot) {
    console.log('Starting Slack Bot...');
    await slackBot.start();
  }

  if (emailBot) {
    console.log('Starting Email Bot...');
    await emailBot.start();
  }

  // Telegram uses long polling — bot.launch() never resolves, so start it last
  if (telegramBot) {
    console.log('Starting Telegram Bot...');
    telegramBot.start();
  }

  console.log('All services started successfully!');
  if (config.discord) {
    console.log('Discord Bot is ready.');
  }
  if (lineConfig) {
    console.log('LINE Bot is ready. Set webhook URL to: https://<your-domain>:' + mcpPort + '/line/webhook');
  }
  if (slackConfig) {
    console.log('Slack Bot is ready (Socket Mode).');
  }
  if (telegramConfig) {
    console.log('Telegram Bot is ready (Long Polling).');
  }
  if (emailConfig) {
    console.log('Email Bot is ready (IMAP IDLE).');
  }
  if (webUIConfig) {
    console.log(`Web UI is ready at http://localhost:${mcpPort}/`);
  }
}

main().catch(console.error);
