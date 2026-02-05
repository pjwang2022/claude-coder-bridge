# Claude Code Multi-Platform Bot

[繁體中文](README.zh-TW.md) | English

Run [Claude Code](https://docs.anthropic.com/en/docs/claude-code) sessions from Discord, LINE, Slack, Telegram, Email, or Web UI. Each platform maps messages to project folders on your filesystem, with interactive tool approval, session persistence, and real-time streaming.

![image](https://github.com/user-attachments/assets/d78c6dcd-eb28-48b6-be1c-74e25935b86b)

> **⚠️ Warning: Personal Use Only**
>
> This project is intended for **personal use only**. Sharing your Claude Code access with others or using this bot to provide Claude Code as a service may violate [Anthropic's Terms of Service](https://www.anthropic.com/legal/consumer-terms). Violations could result in your account being suspended or terminated. Please use responsibly.

## Supported Platforms

| Platform | Connection | Project Selection | Approval UX | Media |
|----------|-----------|-------------------|-------------|-------|
| **Discord** | WebSocket | Channel name = folder | Reaction (check/X) | Images |
| **LINE** | Webhook | `/project <name>` command | Postback buttons | Images, Voice |
| **Slack** | Socket Mode | Channel name = folder | Reaction (check/X) | Images |
| **Telegram** | Long Polling | `/project <name>` command | Inline keyboard | Images, Voice |
| **Email** | IMAP IDLE | Subject tag `[project-name]` | Clickable link | Image attachments |
| **Web UI** | WebSocket | Dropdown selector | In-browser modal | - |

You can enable any combination of platforms simultaneously. At least one platform must be configured.

## Quickstart

1. Install [Node.js](https://nodejs.org/) (v18+) and [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
2. Clone and install:
   ```bash
   git clone <repository-url>
   cd claude-code-discord-bot
   npm install
   ```
3. Create `.env` from the template:
   ```bash
   cp .env.example .env
   ```
4. Set `BASE_FOLDER` and configure at least one platform (see [Platform Setup](#platform-setup))
5. Run:
   ```bash
   npm start
   ```

## How It Works

```
User Message (Discord / LINE / Slack / Telegram / Email / Web UI)
    |
    v
Bot parses message, determines project folder
    |
    v
Spawns: claude --output-format stream-json -p 'prompt' --mcp-config ...
    |
    v
Claude Code runs in BASE_FOLDER/{project-name}/
    |
    |-- Safe tools (Read, Glob, Grep, ...) --> auto-approved
    |-- Dangerous tools (Bash, Write, Edit, ...) --> asks user for approval
    |
    v
Results streamed back to user via platform API
```

### Architecture

- **MCP Permission Server** (Express.js on port 3001) handles tool approval requests
- **mcp-bridge.cjs** bridges Claude Code's stdio MCP protocol to the HTTP server
- Each platform has its own permission manager with native approval UX
- SQLite database stores sessions and task history

### Two Operating Modes

**Synchronous** (Discord, Slack, Web UI): One Claude process per channel/connection. Messages queue if a process is already running. Sessions persist and resume across messages.

**Asynchronous** (LINE, Telegram, Email): Tasks run in the background. Users can send new messages while tasks are running. Results are delivered as push notifications when complete.

### Claude API Mode (Alternative)

By default, this bot spawns Claude Code CLI processes. Alternatively, you can use the **Claude API directly** without installing Claude Code CLI:

```env
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514   # Optional
ANTHROPIC_MAX_TOKENS=8192                   # Optional
```

| Feature | CLI Mode (default) | API Mode |
|---------|-------------------|----------|
| Requires Claude Code CLI | Yes | No |
| Requires ANTHROPIC_API_KEY | No | Yes |
| Available tools | All Claude Code tools | Read, Glob, Grep, Bash, Write, Edit |
| Session persistence | Via Claude Code | In-memory only |
| Cost tracking | No | Yes (per-session) |

API mode is useful if you don't have Claude Code CLI installed or want more control over API parameters.

## Platform Setup

### Common Configuration

Required for all platforms:

```env
# Base path containing your project folders
BASE_FOLDER=/Users/you/repos
```

Your project folders should be organized under `BASE_FOLDER`:

```
/Users/you/repos/
├── my-app/           # Discord: #my-app channel / LINE+Telegram: /project my-app / Email: [my-app]
├── api-server/
├── frontend/
└── experiments/
```

---

### Discord

Create a bot at the [Discord Developer Portal](https://discord.com/developers/applications):

1. New Application > Bot section > Copy token
2. Enable **Message Content Intent** under Privileged Gateway Intents
3. OAuth2 > URL Generator > Scopes: `bot`, `applications.commands`
4. Bot Permissions: Send Messages, Use Slash Commands, Read Message History, Embed Links, Add Reactions
5. Invite the bot to your server with the generated URL

```env
DISCORD_TOKEN=your_bot_token
ALLOWED_USER_ID=your_discord_user_id
```

**How to get your User ID**: Discord Settings > Advanced > Enable Developer Mode > Right-click your name > Copy User ID

**Usage**: Create Discord channels matching your folder names. Send messages in any channel (except `#general`) to run Claude Code in the corresponding folder.

| Command | Description |
|---------|-------------|
| Any message | Run Claude Code with your message as the prompt |
| `/cancel` | Cancel the current running task (session preserved) |
| `/clear` | Reset the current channel's session |

**Approval**: When Claude needs to run a dangerous tool, the bot posts a message. React with :white_check_mark: to approve or :x: to deny. Timeout: 30 seconds.

---

### LINE

Create a bot at the [LINE Developers Console](https://developers.line.biz/):

1. Create a Messaging API channel
2. Copy the Channel Access Token and Channel Secret
3. Set the webhook URL to `https://<your-domain>:3001/line/webhook`

```env
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
LINE_CHANNEL_SECRET=your_channel_secret
LINE_ALLOWED_USER_IDS=U1234abc,U5678def   # Optional: restrict access
```

**Usage**: Send direct messages to the bot. Select a project first, then send prompts.

| Command | Description |
|---------|-------------|
| `/project` | List available projects |
| `/project <name>` | Select a project |
| `/result` | Get the latest task result |
| `/status` | Check running tasks |
| `/cancel` | Cancel the current running task (session preserved) |
| `/clear` | Clear the session for the current project |
| `/help` | Show help |
| Any message | Run Claude Code (requires project selected) |
| Send photo | Attach image to prompt |
| Send voice | Transcribe and run as prompt (requires Speechmatics) |

**Approval**: Bot sends a flex message with Approve / Deny buttons. Timeout: 5 minutes.

**Note**: LINE requires a public HTTPS URL for the webhook endpoint. You need a reverse proxy or tunnel (e.g., ngrok) pointing to port 3001.

---

### Slack

Create an app at [api.slack.com/apps](https://api.slack.com/apps):

1. Create new app > From scratch
2. Enable **Socket Mode** (Settings > Socket Mode) and generate an App-Level Token with `connections:write` scope
3. Event Subscriptions > Subscribe to: `message.channels`, `message.groups`, `reaction_added`
4. OAuth & Permissions > Bot Token Scopes: `chat:write`, `channels:history`, `channels:read`, `groups:read`, `groups:history`, `groups:write`, `reactions:read`, `reactions:write`, `files:read`, `commands`
5. Slash Commands > Create these commands (Request URL is not needed for Socket Mode):
   - `/clear` - Reset the session
   - `/cancel` - Cancel the current task
   - `/project` - Select a project (for DMs)
6. Install to workspace and copy the Bot Token

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_ALLOWED_USER_IDS=U01234567,U89012345   # Optional: restrict access
```

**Usage**: Invite the bot to channels matching your folder names, or send direct messages.

| Context | Project Selection |
|---------|-------------------|
| Channel | Channel name = folder (e.g., `#my-app` → `BASE_FOLDER/my-app`) |
| DM | Use `/project <name>` command to select |

| Command | Description |
|---------|-------------|
| Any message | Run Claude Code with your message as the prompt |
| `/project` | (DM only) List available projects |
| `/project <name>` | (DM only) Select a project |
| `/cancel` | Cancel the current running task (session preserved) |
| `/clear` | Reset the current channel's session |

**Approval**: Bot posts an approval message. React with :white_check_mark: to approve or :x: to deny. Timeout: 30 seconds.

**Note**: Slack uses Socket Mode, so no public URL is needed.

---

### Telegram

Create a bot via [@BotFather](https://t.me/BotFather):

1. Send `/newbot` to BotFather and follow the prompts
2. Copy the bot token

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321   # Optional: restrict access
```

**Usage**: Send direct messages to the bot. Select a project first, then send prompts.

| Command | Description |
|---------|-------------|
| `/start` | Welcome message |
| `/project` | List available projects |
| `/project <name>` | Select a project |
| `/result` | Get the latest task result |
| `/status` | Check running tasks |
| `/cancel` | Cancel the current running task (session preserved) |
| `/clear` | Clear the session for the current project |
| `/help` | Show help |
| Any message | Run Claude Code (requires project selected) |
| Send photo | Attach image to prompt |
| Send voice | Transcribe and run as prompt (requires Speechmatics) |

**Approval**: Bot sends a message with inline Approve / Deny buttons. Timeout: 5 minutes.

**Note**: Telegram uses long polling, so no public URL is needed.

---

### Email

Use any email account that supports IMAP and SMTP (Gmail, Outlook, etc.).

For Gmail: enable [App Passwords](https://myaccount.google.com/apppasswords) (requires 2FA enabled).

```env
EMAIL_USER=claude-bot@gmail.com
EMAIL_PASS=your_app_password
EMAIL_IMAP_HOST=imap.gmail.com        # Optional, defaults shown
EMAIL_IMAP_PORT=993
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_ALLOWED_SENDERS=user@example.com,user2@example.com   # Optional: restrict access
```

**Usage**: Send emails to the bot address. Include the project name in the subject line using brackets.

| Action | Description |
|--------|-------------|
| `Subject: [my-app] fix the login bug` | Run Claude Code in the `my-app` folder with the email body as the prompt |
| Body: `/result` | Get the latest task result |
| Body: `/status` | Check running tasks |
| Body: `/cancel` | Cancel the current running task (session preserved) |
| Body: `/clear` | Clear the session for the project in the subject |
| Body: `/help` | Show help |

**Approval**: Bot sends an HTML email with clickable Approve / Deny links. Each link contains a one-time token. Timeout: 5 minutes.

**Note**: Email uses IMAP IDLE for real-time monitoring. Replies maintain the email thread via `In-Reply-To` and `References` headers.

**Remote servers**: If running on a remote server, set `PUBLIC_URL` so approval links point to the correct address:
```env
PUBLIC_URL=https://your-domain.com:3001
```

---

### Web UI

No external accounts needed. The Web UI runs on the same server as the MCP permission server.

```env
WEB_UI_ENABLED=true
WEB_UI_PASSWORD=your_secret_password   # Optional: leave unset for no auth
```

**Usage**: Open `http://localhost:3001/` in your browser. Select a project from the dropdown, then type prompts.

| Action | Description |
|--------|-------------|
| Select project dropdown | Choose which project folder to work in |
| Type message + Send | Run Claude Code with your message as the prompt |
| Cancel Task button | Cancel the current running task (session preserved) |
| Clear Session button | Reset the session for the current project |

**Approval**: When Claude needs to run a dangerous tool, a modal pops up in the browser with Approve / Deny buttons. Timeout: 120 seconds.

**Features**: Real-time streaming via WebSocket, dark theme UI, tool call tracking with status indicators.

**Note**: No public URL is needed. The Web UI is served from the existing Express server.

---

## Voice Transcription (Speechmatics)

LINE and Telegram support voice messages. To enable transcription, add a [Speechmatics](https://www.speechmatics.com/) API key:

```env
SPEECHMATICS_API_KEY=your_api_key
SPEECHMATICS_LANGUAGE=cmn    # Language code (default: cmn). Use cmn_en for Mandarin & English bilingual.
```

Supported languages: `en`, `cmn`, `cmn_en`, `ja`, `ko`, `fr`, `de`, `es`, and [many more](https://docs.speechmatics.com/speech-to-text/languages).

Voice messages are transcribed to text and then passed to Claude Code as the prompt.

## Tool Approval System

Claude Code uses various tools (read files, write files, run commands, etc.). This bot categorizes them:

**Auto-approved** (safe, read-only):
- `Read`, `Glob`, `Grep`, `LS`, `TodoRead`, `WebFetch`, `WebSearch`

**Requires approval** (modifies filesystem or runs commands):
- `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `TodoWrite`

**Denied** (unknown tools):
- Any tool not in the above lists is denied by default

When approval is needed, the bot sends a platform-native prompt and waits for the user to approve or deny. If no response is received within the timeout, the tool is denied.

| Platform | Approval Method | Timeout |
|----------|----------------|---------|
| Discord | Reaction (check/X) | 30s |
| LINE | Postback buttons | 5 min |
| Slack | Reaction (check/X) | 30s |
| Telegram | Inline keyboard | 5 min |
| Email | HTTP link click | 5 min |
| Web UI | Browser modal | 2 min |

### Auto-Approve Tools

To skip interactive approval for specific tools, set `AUTO_APPROVE_TOOLS` in your `.env`:

```env
AUTO_APPROVE_TOOLS=Edit,Write
```

Available tool names for auto-approval:

| Tool | Description |
|------|-------------|
| `Bash` | Run shell commands |
| `Write` | Create or overwrite files |
| `Edit` | Edit existing files |
| `MultiEdit` | Edit multiple locations in a file |
| `TodoWrite` | Write todo items |

Comma-separated, case-sensitive. Tools not listed here will still follow the default approval flow.

## Advanced Configuration

```env
# MCP server port (default: 3001)
MCP_SERVER_PORT=3001

# Claude process timeout in seconds (default: 300, max: 43200 = 12 hours)
CLAUDE_PROCESS_TIMEOUT=300

# Discord/Slack approval timeout in seconds (default: 30)
MCP_APPROVAL_TIMEOUT=30

# Default behavior on timeout: 'allow' or 'deny' (default: deny)
MCP_DEFAULT_ON_TIMEOUT=deny

# LINE approval timeout in seconds (default: 300)
LINE_APPROVAL_TIMEOUT=300

# Telegram approval timeout in seconds (default: 300)
TELEGRAM_APPROVAL_TIMEOUT=300

# Email approval timeout in seconds (default: 300)
EMAIL_APPROVAL_TIMEOUT=300

# WebUI approval timeout in seconds (default: 120)
WEBUI_APPROVAL_TIMEOUT=120

# Auto-approve specific tools without interactive approval (comma-separated)
# Available: Bash, Write, Edit, MultiEdit, TodoWrite
# AUTO_APPROVE_TOOLS=Edit,Write
```

## Development

### Project Structure

```
src/
├── index.ts                  # Entry point, initializes all enabled platforms
├── types/index.ts            # Shared type definitions
├── utils/config.ts           # Environment validation
├── shared/
│   ├── shell.ts              # Claude CLI command builder
│   ├── process-runner.ts     # Spawns and streams Claude processes
│   ├── base-permission-manager.ts  # Abstract approval logic
│   ├── permissions.ts        # Tool safety classification
│   └── speechmatics.ts      # STT API integration
├── db/database.ts            # SQLite: sessions + task results
├── mcp/server.ts             # Express.js MCP permission server
└── channel/
    ├── discord/              # Discord.js bot
    ├── line/                 # LINE webhook handler
    ├── slack/                # Slack Bolt bot (Socket Mode)
    ├── telegram/             # Telegraf bot (Long Polling)
    ├── email/                # IMAP IDLE + SMTP
    └── webui/                # WebSocket + static HTML
```

Each channel directory contains:
- `client.ts` — Bot client (event handling, commands)
- `manager.ts` — Claude Code session/task management
- `permission-manager.ts` — Platform-specific approval UX
- `shell.ts` — Platform-specific command builder
- `messages.ts` — Message formatting
- `types.ts` — Type definitions

### Running Tests

```bash
npm run test:run    # Run once
npm test            # Watch mode
```

### Adding a New Platform

1. Create `src/channel/<platform>/` with the 6 standard files
2. Add platform to `PlatformBridgeConfig.platform` union in `src/shared/shell.ts`
3. Add platform config to `mcp-bridge.cjs`
4. Add MCP route in `src/mcp/server.ts`
5. Add database tables in `src/db/database.ts` (if async task model)
6. Add config validation in `src/utils/config.ts`
7. Add initialization in `src/index.ts`

## Health Check

When running, the MCP server exposes a health endpoint:

```bash
curl http://localhost:3001/health
```

```json
{
  "status": "ok",
  "server": "Claude Code Permission Server",
  "version": "1.0.0",
  "port": 3001
}
```

## Acknowledgments

This project was originally inspired by [claude-code-discord-bot](https://github.com/timoconnellaus/claude-code-discord-bot) by [@timoconnellaus](https://github.com/timoconnellaus). The initial Discord integration concept came from that project. This repository has since been substantially rewritten and expanded to support multiple platforms (LINE, Slack, Telegram, Email, Web UI), a shared architecture, and many additional features.

## License

MIT License. See [LICENSE](LICENSE) for details.
