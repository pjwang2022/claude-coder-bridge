import type { Config } from '../types/index.js';
import type { LineConfig } from '../line/types.js';

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
  };
}