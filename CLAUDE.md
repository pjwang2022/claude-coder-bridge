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

A Discord + LINE bot that spawns Claude Code CLI processes, with an MCP server for interactive tool permission approvals. Discord uses real-time streaming; LINE uses async task completion with polling.

### Startup Flow (`src/index.ts`)

1. `validateConfig()` - validates environment variables
2. `MCPPermissionServer.start()` - Express HTTP server on port 3001
3. `ClaudeManager` + `DiscordBot` created and cross-linked
4. If LINE env vars set: `LINEClaudeManager` + `LineBotHandler` + `LinePermissionManager` created, LINE routes registered on same Express server
5. `bot.login()` - connects to Discord
6. MCP server and bot are connected bidirectionally for reaction handling

### Core Modules

- **`src/bot/client.ts`** (`DiscordBot`) - Discord.js client, routes messages to Claude, handles approval reactions (✅/❌)
- **`src/bot/commands.ts`** (`CommandHandler`) - Slash command registration (`/clear`)
- **`src/claude/manager.ts`** (`ClaudeManager`) - Spawns Claude Code CLI as child processes, parses streaming JSON output, updates Discord embeds in real-time. Tracks active processes per channel with race condition prevention.
- **`src/mcp/server.ts`** (`MCPPermissionServer`) - Express HTTP server exposing `approve_tool` via MCP protocol. Uses `StreamableHTTPServerTransport`.
- **`src/mcp/permission-manager.ts`** (`PermissionManager`) - Bridges MCP permission requests to Discord messages with reaction-based approval. Handles timeouts and auto-decisions.
- **`src/mcp/permissions.ts`** - Tool safety classification. Safe tools (Read, Glob, Grep, etc.) auto-approve. Dangerous tools (Bash, Write, Edit) require Discord approval.
- **`src/db/database.ts`** (`DatabaseManager`) - SQLite session persistence (`better-sqlite3`). Stores channel-to-session mappings with 30-day auto-cleanup.
- **`src/utils/shell.ts`** - Builds the Claude CLI command string. Creates per-session MCP config files in `/tmp` with Discord context as env vars. Handles shell escaping.
- **`mcp-bridge.cjs`** - Node.js stdio-to-HTTP bridge. Claude Code spawns this as an MCP server; it forwards JSON-RPC to `localhost:3001` with Discord context headers.

#### LINE Modules (parallel path, does not modify Discord code)

- **`src/claude/process-runner.ts`** - Shared process spawn + JSON stream parser. Callback-based, no platform dependencies. Used by `LINEClaudeManager`.
- **`src/line/bot.ts`** (`LineBotHandler`) - LINE webhook handler. Validates HMAC signature, routes commands (`/project`, `/result`, `/status`, `/clear`), handles Postback events for approvals. Auto-leaves groups.
- **`src/line/manager.ts`** (`LINEClaudeManager`) - Spawns Claude Code using process-runner, accumulates tool calls + result, stores in `line_task_results` table. Pushes notification on completion if quota available.
- **`src/line/permission-manager.ts`** (`LinePermissionManager`) - Sends Flex Message with Approve/Deny Postback buttons. 5-min timeout (auto-deny).
- **`src/line/messages.ts`** - Flex Message builders for results, approvals, project lists.
- **`src/line/shell.ts`** - Builds Claude CLI command with LINE MCP config.
- **`src/line/types.ts`** - LINE-specific type definitions.
- **`line-mcp-bridge.cjs`** - LINE version of MCP bridge (posts to `/line/mcp` with `X-Line-*` headers).

### Message Flow

```
Discord message → DiscordBot.handleMessage() → ClaudeManager.runClaudeCode()
  → spawns: /bin/bash with `claude --output-format stream-json` command
  → reads streaming JSON (system.init, assistant, user, result message types)
  → updates Discord embeds in real-time
```

### Permission Flow

```
Claude Code needs tool approval → spawns mcp-bridge.cjs (stdio)
  → HTTP POST to localhost:3001/mcp with Discord context headers
  → MCPPermissionServer → PermissionManager.requestApproval()
  → sends Discord embed with ✅/❌ reactions → waits for user reaction
  → returns allow/deny decision back through the chain
```

### Channel-to-Folder Mapping

Each Discord channel name maps directly to a folder under `BASE_FOLDER`. Channel `#my-project` operates in `BASE_FOLDER/my-project`. The "general" channel is skipped.

### LINE Message Flow (async)

```
LINE message → POST /line/webhook → LineBotHandler
  → validates HMAC signature, auth check (allowlist)
  → /project, /result, /status, /clear commands handled directly via Reply API (free)
  → regular text: Reply "Processing..." → LINEClaudeManager.runTask() (background)
    → spawnClaudeProcess → accumulates results → stores in line_task_results
    → push notification if quota available
User sends /result → Reply with Flex Message showing stored result
```

### LINE Permission Flow

```
Claude Code needs approval → line-mcp-bridge.cjs → POST /line/mcp
  → LinePermissionManager → Push Flex Message with Approve/Deny buttons
  → User taps button → Postback event → handlePostback() → resolve
  → 5-min timeout → auto-deny
```

### Session Persistence

Session IDs from Claude Code's `system.init` messages are stored in SQLite. On subsequent messages in the same channel, the session is resumed via `--resume <sessionId>`. LINE uses `line:{userId}:{projectName}` as session keys to avoid collision with Discord channel IDs.

## Environment Variables

Required:
- `DISCORD_TOKEN` - Bot token
- `ALLOWED_USER_ID` - Discord user ID authorized to use the bot
- `BASE_FOLDER` - Base path for channel-to-folder mapping

Optional (Discord):
- `MCP_SERVER_PORT` - MCP HTTP server port (default: 3001)
- `MCP_APPROVAL_TIMEOUT` - Seconds to wait for approval reaction (default: 30)
- `MCP_DEFAULT_ON_TIMEOUT` - Auto-decision on timeout: "allow" or "deny" (default: deny)

Optional (LINE — if not set, LINE bot is skipped):
- `LINE_CHANNEL_ACCESS_TOKEN` - LINE Bot channel access token
- `LINE_CHANNEL_SECRET` - LINE Bot channel secret (for webhook HMAC signature)
- `LINE_ALLOWED_USER_IDS` - Comma-separated LINE user IDs authorized to use the bot
- `LINE_APPROVAL_TIMEOUT` - Seconds to wait for LINE approval (default: 300)