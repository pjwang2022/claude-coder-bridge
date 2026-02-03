export interface SlackConfig {
  botToken: string;
  appToken: string;
  signingSecret: string;
  allowedUserIds: string[];
}
