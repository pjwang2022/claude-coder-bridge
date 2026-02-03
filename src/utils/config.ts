import type { Config } from '../types/index.js';
import type { LineConfig } from '../channel/line/types.js';
import type { SlackConfig } from '../channel/slack/types.js';
import type { TelegramConfig } from '../channel/telegram/types.js';
import type { EmailConfig } from '../channel/email/types.js';
import type { WebUIConfig } from '../channel/webui/types.js';
import type { TeamsConfig } from '../channel/teams/types.js';

export function validateConfig(): Config {
  const baseFolder = process.env.BASE_FOLDER;

  if (!baseFolder) {
    console.error("BASE_FOLDER environment variable is required");
    process.exit(1);
  }

  const discordToken = process.env.DISCORD_TOKEN;
  const allowedUserId = process.env.ALLOWED_USER_ID;

  const discord = discordToken && allowedUserId
    ? { token: discordToken, allowedUserId }
    : undefined;

  return {
    baseFolder,
    discord,
  };
}

export function validateLineConfig(): LineConfig | null {
  const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const allowedUserIds = process.env.LINE_ALLOWED_USER_IDS;
  const baseFolder = process.env.BASE_FOLDER;

  if (!channelAccessToken || !channelSecret) {
    return null;
  }

  if (!baseFolder) {
    console.error("BASE_FOLDER is required for LINE bot");
    return null;
  }

  return {
    channelAccessToken,
    channelSecret,
    allowedUserIds: allowedUserIds
      ? allowedUserIds.split(',').map(id => id.trim()).filter(Boolean)
      : [],
    baseFolder,
    speechmaticsApiKey: process.env.SPEECHMATICS_API_KEY || undefined,
    speechmaticsLanguage: process.env.SPEECHMATICS_LANGUAGE || 'cmn',
  };
}

export function validateSlackConfig(): SlackConfig | null {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;

  if (!botToken || !appToken || !signingSecret) {
    return null;
  }

  const allowedUserIds = process.env.SLACK_ALLOWED_USER_IDS;

  return {
    botToken,
    appToken,
    signingSecret,
    allowedUserIds: allowedUserIds
      ? allowedUserIds.split(',').map(id => id.trim()).filter(Boolean)
      : [],
  };
}

export function validateTelegramConfig(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    return null;
  }

  const allowedUserIds = process.env.TELEGRAM_ALLOWED_USER_IDS;

  return {
    botToken,
    allowedUserIds: allowedUserIds
      ? allowedUserIds.split(',').map(id => parseInt(id.trim())).filter(n => !isNaN(n))
      : [],
  };
}

export function validateEmailConfig(): EmailConfig | null {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  if (!emailUser || !emailPass) {
    return null;
  }

  return {
    imapHost: process.env.EMAIL_IMAP_HOST || 'imap.gmail.com',
    imapPort: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
    smtpHost: process.env.EMAIL_SMTP_HOST || 'smtp.gmail.com',
    smtpPort: parseInt(process.env.EMAIL_SMTP_PORT || '587'),
    emailUser,
    emailPass,
    allowedSenders: process.env.EMAIL_ALLOWED_SENDERS
      ? process.env.EMAIL_ALLOWED_SENDERS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [],
  };
}

export function validateWebUIConfig(): WebUIConfig | null {
  const enabled = process.env.WEB_UI_ENABLED;

  if (!enabled || enabled.toLowerCase() !== 'true') {
    return null;
  }

  return {
    password: process.env.WEB_UI_PASSWORD || undefined,
  };
}

export function getProcessTimeoutMs(): number {
  return parseInt(process.env.CLAUDE_PROCESS_TIMEOUT || '300') * 1000;
}

export function validateTeamsConfig(): TeamsConfig | null {
  const appId = process.env.TEAMS_APP_ID;
  const appPassword = process.env.TEAMS_APP_PASSWORD;

  if (!appId || !appPassword) {
    return null;
  }

  const allowedUserIds = process.env.TEAMS_ALLOWED_USER_IDS;

  return {
    appId,
    appPassword,
    allowedUserIds: allowedUserIds
      ? allowedUserIds.split(',').map(id => id.trim()).filter(Boolean)
      : [],
  };
}