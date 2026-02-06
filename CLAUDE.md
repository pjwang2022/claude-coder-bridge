# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm install` - Install dependencies
- `npm run test:run` - Run tests (vitest, single run).
- `npm start` - Run the application (but see restrictions below)

## Important Restrictions

- **Never run the bot.** Do not use `npm start` or `npx tsx src/index.ts`.
- You can run tests, but never run the main application.

## Runtime

This project uses **Node.js** with **tsx** as the TypeScript runner. Environment variables are loaded via `dotenv`. TypeScript strict mode is enabled with ESNext target and bundler module resolution. SQLite is provided by `better-sqlite3`.

## Architecture

A multi-platform bot (Discord, LINE, Slack, Telegram, Email, Web UI) that spawns Claude Code CLI processes, with an MCP server for interactive tool permission approvals. Synchronous platforms (Discord, Slack, Web UI) use real-time streaming; asynchronous platforms (LINE, Telegram, Email) use background task completion with push notifications.

### Startup Flow (`src/index.ts`)

1. `validateConfig()` + platform-specific validators - validates environment variables
2. `MCPPermissionServer.start()` - Express HTTP server on port 3001
3. For each enabled platform: create ClaudeManager + Bot + PermissionManager, register MCP routes
4. Start all bots (Discord login, Slack Socket Mode, Telegram long polling, Email IMAP IDLE, Web UI WebSocket)
5. MCP server and bots are connected bidirectionally for approval handling

### Core Modules

- **`src/mcp/server.ts`** (`MCPPermissionServer`) - Express HTTP server exposing `approve_tool` via MCP protocol. Routes MCP requests to the correct platform's permission manager.
- **`src/shared/base-permission-manager.ts`** - Abstract approval logic shared by all platforms. Handles tool classification, timeouts, and auto-approve.
- **`src/shared/permissions.ts`** - Tool safety classification. Safe tools (Read, Glob, Grep, etc.) auto-approve. Dangerous tools (Bash, Write, Edit) require approval.
- **`src/shared/process-runner.ts`** - Shared process spawn + JSON stream parser. Callback-based, no platform dependencies.
- **`src/shared/shell.ts`** - Builds the Claude CLI command string. Creates per-session MCP config files in `/tmp` with platform context as env vars.
- **`src/db/database.ts`** (`DatabaseManager`) - SQLite session persistence (`better-sqlite3`). Stores channel-to-session mappings with auto-cleanup.
- **`mcp-bridge.cjs`** - Node.js stdio-to-HTTP bridge. Claude Code spawns this as an MCP server; it forwards JSON-RPC to `localhost:3001` with platform context headers.

### Platform Modules (`src/channel/<platform>/`)

Each platform directory follows the same structure:
- `client.ts` — Bot client (event handling, commands, message routing)
- `manager.ts` — Claude Code session/task management
- `permission-manager.ts` — Platform-specific approval UX (extends `BasePermissionManager`)
- `shell.ts` — Platform-specific CLI command builder
- `types.ts` — Type definitions

Platforms: `discord/`, `line/`, `slack/`, `telegram/`, `email/`, `webui/`

### Message Flow (Synchronous — Discord, Slack, Web UI)

```
User message → Bot.handleMessage() → ClaudeManager.runClaudeCode()
  → spawns: /bin/bash with `claude --output-format stream-json` command
  → reads streaming JSON (system.init, assistant, user, result message types)
  → updates platform messages in real-time
```

### Message Flow (Asynchronous — LINE, Telegram, Email)

```
User message → Bot handler → reply "Processing..." → ClaudeManager.runTask() (background)
  → spawnClaudeProcess → accumulates results → stores in task_results table
  → push notification on completion
User sends /result → reply with stored result
```

### Permission Flow

```
Claude Code needs tool approval → spawns mcp-bridge.cjs (stdio)
  → HTTP POST to localhost:3001/<platform>/mcp with platform context headers
  → MCPPermissionServer → PlatformPermissionManager.requestApproval()
  → sends platform-native approval prompt → waits for user response
  → returns allow/deny decision back through the chain
```

### Project-to-Folder Mapping

- **Discord/Slack channels**: Channel name maps directly to folder under `BASE_FOLDER`. Channel `#my-project` → `BASE_FOLDER/my-project`. The "general" channel is skipped.
- **LINE/Telegram DMs**: User selects project via `/project <name>` command.
- **Slack DMs**: User selects project via `/project <name>` command.
- **Email**: Subject tag `[project-name]` maps to folder.
- **Web UI**: Dropdown selector lists available folders.

### Session Persistence

Session IDs from Claude Code's `system.init` messages are stored in SQLite. On subsequent messages in the same channel/project, the session is resumed via `--resume <sessionId>`. Each platform uses unique session key prefixes to avoid collisions (e.g., `slack:dm:{userId}:{project}`, `line:{userId}:{project}`).

## Environment Variables

Required:
- `BASE_FOLDER` - Base path for project-to-folder mapping

At least one platform must be configured. Each platform is optional.

Discord:
- `DISCORD_TOKEN` - Bot token
- `ALLOWED_USER_IDS` - Comma-separated Discord user IDs authorized to use the bot
- `DISCORD_CHANNEL_IDS` - Comma-separated channel IDs to restrict the bot to (default: all channels)

LINE:
- `LINE_CHANNEL_ACCESS_TOKEN` - LINE Bot channel access token
- `LINE_CHANNEL_SECRET` - LINE Bot channel secret (for webhook HMAC signature)
- `LINE_ALLOWED_USER_IDS` - Comma-separated LINE user IDs authorized to use the bot
- `LINE_APPROVAL_TIMEOUT` - Seconds to wait for LINE approval (default: 300)

Slack:
- `SLACK_BOT_TOKEN` - Slack Bot token
- `SLACK_APP_TOKEN` - Slack App-level token (Socket Mode)
- `SLACK_SIGNING_SECRET` - Slack signing secret
- `SLACK_ALLOWED_USER_IDS` - Comma-separated Slack user IDs authorized to use the bot
- `SLACK_CHANNEL_IDS` - Comma-separated channel IDs to restrict the bot to (default: all channels)

Telegram:
- `TELEGRAM_BOT_TOKEN` - Telegram Bot token
- `TELEGRAM_ALLOWED_USER_IDS` - Comma-separated Telegram user IDs (numeric)
- `TELEGRAM_APPROVAL_TIMEOUT` - Seconds to wait for approval (default: 300)

Email:
- `EMAIL_USER` - Email address (e.g., claude-bot@gmail.com)
- `EMAIL_PASS` - Email password or app password
- `EMAIL_ALLOWED_SENDERS` - Comma-separated allowed sender emails

Web UI:
- `WEB_UI_ENABLED` - Set to `true` to enable
- `WEB_UI_PASSWORD` - Optional password for auth

General:
- `MCP_SERVER_PORT` - MCP HTTP server port (default: 3001)
- `MCP_APPROVAL_TIMEOUT` - Seconds to wait for Discord/Slack approval reaction (default: 30)
- `MCP_DEFAULT_ON_TIMEOUT` - Auto-decision on timeout: "allow" or "deny" (default: deny)
- `CLAUDE_PROCESS_TIMEOUT` - Seconds before killing a Claude process (default: 300)
- `AUTO_APPROVE_TOOLS` - Comma-separated tool names to auto-approve (e.g., `Edit,Write`)