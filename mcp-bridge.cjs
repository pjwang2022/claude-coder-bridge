#!/usr/bin/env node

// Unified MCP bridge: connects stdio to our HTTP MCP server.
// Supports Discord and LINE via the PLATFORM env var.
const http = require('http');
const { Transform } = require('stream');

const PLATFORM = process.env.PLATFORM || 'discord';
const MCP_PORT = process.env.MCP_SERVER_PORT || '3001';

const PLATFORM_CONFIG = {
  discord: {
    path: '/mcp',
    headers: [
      { env: 'DISCORD_CHANNEL_ID', header: 'X-Discord-Channel-Id' },
      { env: 'DISCORD_CHANNEL_NAME', header: 'X-Discord-Channel-Name' },
      { env: 'DISCORD_USER_ID', header: 'X-Discord-User-Id' },
      { env: 'DISCORD_MESSAGE_ID', header: 'X-Discord-Message-Id' },
    ],
  },
  line: {
    path: '/line/mcp',
    headers: [
      { env: 'LINE_USER_ID', header: 'X-Line-User-Id' },
      { env: 'LINE_PROJECT_NAME', header: 'X-Line-Project-Name' },
    ],
  },
  slack: {
    path: '/slack/mcp',
    headers: [
      { env: 'SLACK_CHANNEL_ID', header: 'X-Slack-Channel-Id' },
      { env: 'SLACK_CHANNEL_NAME', header: 'X-Slack-Channel-Name' },
      { env: 'SLACK_USER_ID', header: 'X-Slack-User-Id' },
      { env: 'SLACK_THREAD_TS', header: 'X-Slack-Thread-Ts' },
    ],
  },
  telegram: {
    path: '/telegram/mcp',
    headers: [
      { env: 'TELEGRAM_USER_ID', header: 'X-Telegram-User-Id' },
      { env: 'TELEGRAM_CHAT_ID', header: 'X-Telegram-Chat-Id' },
      { env: 'TELEGRAM_PROJECT_NAME', header: 'X-Telegram-Project-Name' },
    ],
  },
  email: {
    path: '/email/mcp',
    headers: [
      { env: 'EMAIL_FROM', header: 'X-Email-From' },
      { env: 'EMAIL_PROJECT_NAME', header: 'X-Email-Project-Name' },
      { env: 'EMAIL_MESSAGE_ID', header: 'X-Email-Message-Id' },
    ],
  },
  webui: {
    path: '/webui/mcp',
    headers: [
      { env: 'WEBUI_CONNECTION_ID', header: 'X-WebUI-Connection-Id' },
      { env: 'WEBUI_PROJECT', header: 'X-WebUI-Project' },
    ],
  },
};

const config = PLATFORM_CONFIG[PLATFORM];
if (!config) {
  console.error(`Unknown platform: ${PLATFORM}. Use "discord" or "line".`);
  process.exit(1);
}

console.error(`MCP Bridge startup: platform=${PLATFORM}, port=${MCP_PORT}`);

let inputBuffer = '';

const mcpTransform = new Transform({
  objectMode: false,
  transform(chunk, encoding, callback) {
    inputBuffer += chunk.toString();

    const lines = inputBuffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    inputBuffer = lines.pop() || '';

    const jsonLines = lines.map(l => l.trim()).filter(l => l.length > 0);

    if (jsonLines.length === 0) {
      callback();
      return;
    }

    let pending = jsonLines.length;
    const self = this;

    for (const postData of jsonLines) {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'Content-Length': Buffer.byteLength(postData),
      };

      for (const { env, header } of config.headers) {
        if (process.env[env]) {
          headers[header] = process.env[env];
        }
      }

      const options = {
        hostname: 'localhost',
        port: parseInt(MCP_PORT),
        path: config.path,
        method: 'POST',
        headers,
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          if (responseData.startsWith('event: message\ndata: ')) {
            const jsonData = responseData.replace('event: message\ndata: ', '').trim();
            self.push(jsonData + '\n');
          } else {
            self.push(responseData);
          }
          if (--pending === 0) callback();
        });
      });

      req.on('error', (err) => {
        console.error(`MCP Bridge Error (${PLATFORM}):`, err);
        self.push(JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `MCP server connection failed: ${err.message}`,
          },
          id: null,
        }) + '\n');
        if (--pending === 0) callback();
      });

      req.write(postData);
      req.end();
    }
  },
});

process.stdin.pipe(mcpTransform).pipe(process.stdout);

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
