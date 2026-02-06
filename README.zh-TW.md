# Claude Code 多平台機器人

繁體中文 | [English](README.md)

透過 Discord、LINE、Slack、Telegram、Email 或 Web UI 執行 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) 工作階段。每個平台將訊息對應到你檔案系統上的專案資料夾，支援互動式工具審批、工作階段持久化，以及即時串流輸出。

![image](https://github.com/user-attachments/assets/d78c6dcd-eb28-48b6-be1c-74e25935b86b)

> **⚠️ 警告：僅限個人使用**
>
> 本專案僅供**個人使用**。將您的 Claude Code 存取權分享給他人，或使用此機器人提供 Claude Code 服務，可能違反 [Anthropic 服務條款](https://www.anthropic.com/legal/consumer-terms)。違規行為可能導致您的帳號被暫停或終止。請負責任地使用。

## 支援平台

| 平台 | 連線方式 | 專案選擇 | 審批方式 | 多媒體 |
|------|---------|---------|---------|-------|
| **Discord** | WebSocket | 頻道名稱 = 資料夾 | 表情反應 (check/X) | 圖片 |
| **LINE** | Webhook | `/project <名稱>` 指令 | Postback 按鈕 | 圖片、語音 |
| **Slack** | Socket Mode | 頻道名稱 = 資料夾 | 表情反應 (check/X) | 圖片 |
| **Telegram** | Long Polling | `/project <名稱>` 指令 | Inline 鍵盤按鈕 | 圖片、語音 |
| **Email** | IMAP IDLE | 主旨標籤 `[project-name]` | 點擊連結 | 圖片附件 |
| **Web UI** | WebSocket | 下拉選單 | 瀏覽器彈窗 | - |

可同時啟用任意平台組合，至少需要設定一個平台。

## 快速開始

1. 安裝 [Node.js](https://nodejs.org/)（v18+）和 [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)
2. Clone 並安裝：
   ```bash
   git clone <repository-url>
   cd claude-code-discord-bot
   npm install
   ```
3. 從範本建立 `.env`：
   ```bash
   cp .env.example .env
   ```
4. 設定 `BASE_FOLDER` 並至少設定一個平台（參見[平台設定](#平台設定)）
5. 啟動：
   ```bash
   npm start
   ```

## 運作原理

```
使用者訊息（Discord / LINE / Slack / Telegram / Email / Web UI）
    |
    v
Bot 解析訊息，決定專案資料夾
    |
    v
產生程序：claude --output-format stream-json -p 'prompt' --mcp-config ...
    |
    v
Claude Code 在 BASE_FOLDER/{project-name}/ 中執行
    |
    |-- 安全工具（Read, Glob, Grep, ...）--> 自動核准
    |-- 危險工具（Bash, Write, Edit, ...）--> 向使用者請求審批
    |
    v
結果透過平台 API 即時串流回傳給使用者
```

### 架構

- **MCP Permission Server**（Express.js，預設 port 3001）處理工具審批請求
- **mcp-bridge.cjs** 將 Claude Code 的 stdio MCP 協定橋接到 HTTP 伺服器
- 每個平台有自己的 permission manager，提供原生審批體驗
- SQLite 資料庫儲存工作階段與任務歷史

### 兩種運作模式

**同步模式**（Discord、Slack、Web UI）：每個頻道/連線一個 Claude 程序。程序執行中時新訊息會排隊等待。工作階段會跨訊息持久化並自動恢復。

**非同步模式**（LINE、Telegram、Email）：任務在背景執行。使用者可在任務執行期間繼續傳送新訊息。任務完成後以推播通知方式送回結果。

### Claude API 模式（替代方案）

預設情況下，此機器人會啟動 Claude Code CLI 程序。你也可以選擇**直接使用 Claude API**，不需要安裝 Claude Code CLI：

```env
CLAUDE_MODE=api
ANTHROPIC_API_KEY=sk-ant-api03-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514   # 選填
ANTHROPIC_MAX_TOKENS=8192                   # 選填
```

| 功能 | CLI 模式（預設）| API 模式 |
|-----|----------------|----------|
| 需要 Claude Code CLI | 是 | 否 |
| 需要 ANTHROPIC_API_KEY | 否 | 是 |
| 可用工具 | 所有 Claude Code 工具 | Read, Glob, Grep, Bash, Write, Edit |
| 工作階段持久化 | 透過 Claude Code | 僅記憶體（不持久化）|
| 費用追蹤 | 無 | 有（每次工作階段）|

如果你沒有安裝 Claude Code CLI，或想要更精確控制 API 參數，API 模式會是不錯的選擇。

## 平台設定

### 共通設定

所有平台都需要：

```env
# 專案資料夾的根目錄
BASE_FOLDER=/Users/you/repos
```

專案資料夾結構範例：

```
/Users/you/repos/
├── my-app/           # Discord: #my-app 頻道 / LINE+Telegram: /project my-app / Email: [my-app]
├── api-server/
├── frontend/
└── experiments/
```

---

### Discord

到 [Discord Developer Portal](https://discord.com/developers/applications) 建立機器人：

1. New Application > Bot 區塊 > 複製 token
2. 在 Privileged Gateway Intents 下啟用 **Message Content Intent**
3. OAuth2 > URL Generator > Scopes：`bot`、`applications.commands`
4. Bot Permissions：Send Messages、Use Slash Commands、Read Message History、Embed Links、Add Reactions
5. 用產生的 URL 邀請機器人到你的伺服器

```env
DISCORD_TOKEN=your_bot_token
ALLOWED_USER_IDS=your_discord_user_id1,your_discord_user_id2
```

**取得 User ID**：Discord 設定 > 進階 > 啟用開發者模式 > 右鍵點擊你的名字 > 複製使用者 ID

**使用方式**：建立與資料夾同名的 Discord 頻道。在頻道中（`#general` 除外）傳送訊息即可在對應資料夾執行 Claude Code。

| 指令 | 說明 |
|------|------|
| 任何訊息 | 以訊息內容作為 prompt 執行 Claude Code |
| `/clear` | 重設當前頻道的工作階段 |

**審批**：當 Claude 需要執行危險工具時，機器人會發出審批訊息。以 :white_check_mark: 反應核准，:x: 反應拒絕。逾時：30 秒。

---

### LINE

到 [LINE Developers Console](https://developers.line.biz/) 建立機器人：

1. 建立 Messaging API channel
2. 複製 Channel Access Token 和 Channel Secret
3. 設定 Webhook URL 為 `https://<your-domain>:3001/line/webhook`

```env
LINE_CHANNEL_ACCESS_TOKEN=your_channel_access_token
LINE_CHANNEL_SECRET=your_channel_secret
LINE_ALLOWED_USER_IDS=U1234abc,U5678def   # 選填：限制使用者
```

**使用方式**：直接傳訊息給機器人。先選擇專案，再傳送 prompt。

| 指令 | 說明 |
|------|------|
| `/project` | 列出可用專案 |
| `/project <名稱>` | 選擇專案 |
| `/result` | 取得最新任務結果 |
| `/status` | 查看執行中的任務 |
| `/clear` | 清除當前專案的工作階段 |
| `/help` | 顯示說明 |
| 任何訊息 | 執行 Claude Code（需先選擇專案）|
| 傳送圖片 | 將圖片附加到 prompt |
| 傳送語音 | 語音轉文字後作為 prompt（需要 Speechmatics）|

**審批**：機器人傳送帶有 Approve / Deny 按鈕的 Flex Message。逾時：5 分鐘。

**注意**：LINE 需要公開的 HTTPS URL 作為 webhook 端點。你需要反向代理或通道（如 ngrok）指向 port 3001。

---

### Slack

到 [api.slack.com/apps](https://api.slack.com/apps) 建立應用程式：

1. Create new app > From scratch
2. 啟用 **Socket Mode**（Settings > Socket Mode）並產生 App-Level Token，scope 為 `connections:write`
3. **App Home** > Messages Tab > 勾選 **「Allow users to send Slash commands and messages from the messages tab」**
4. **Event Subscriptions** > 訂閱以下 bot events：
   - `message.channels` - 公開頻道訊息
   - `message.groups` - 私人頻道訊息
   - `message.im` - 私訊
   - `reaction_added` - 反應事件（用於審批）
5. **OAuth & Permissions** > Bot Token Scopes：
   - `chat:write` - 發送訊息
   - `channels:history`、`channels:read` - 讀取公開頻道
   - `groups:history`、`groups:read`、`groups:write` - 讀寫私人頻道
   - `im:history`、`im:read`、`im:write` - 讀寫私訊
   - `reactions:read`、`reactions:write` - 處理審批反應
   - `files:read` - 讀取檔案附件
   - `commands` - Slash 指令
6. **Slash Commands** > 建立以下指令（Socket Mode 不需要 Request URL）：
   - `/clear` - 重設工作階段
   - `/cancel` - 取消當前任務
   - `/project` - 選擇專案
7. 安裝到 workspace 並複製 Bot Token

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_SIGNING_SECRET=your_signing_secret
SLACK_ALLOWED_USER_IDS=U01234567,U89012345   # 選填：限制使用者
```

**使用方式**：邀請機器人到與資料夾同名的頻道，或傳送私訊。

| 情境 | 專案選擇 |
|------|----------|
| 頻道 | 頻道名稱 = 資料夾（例如 `#my-app` → `BASE_FOLDER/my-app`）|
| 私訊 | 使用 `/project <名稱>` 指令選擇 |

| 指令 | 說明 |
|------|------|
| 任何訊息 | 以訊息內容作為 prompt 執行 Claude Code |
| `/project` | 列出可用專案 |
| `/project <名稱>` | 選擇專案 |
| `/cancel` | 取消當前執行中的任務（工作階段保留）|
| `/clear` | 重設當前頻道的工作階段 |

**審批**：機器人發出審批訊息。以 :white_check_mark: 反應核准，:x: 反應拒絕。逾時：30 秒。

**注意**：Slack 使用 Socket Mode，不需要公開 URL。

---

### Telegram

透過 [@BotFather](https://t.me/BotFather) 建立機器人：

1. 向 BotFather 傳送 `/newbot` 並依照指示操作
2. 複製 bot token

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11
TELEGRAM_ALLOWED_USER_IDS=123456789,987654321   # 選填：限制使用者
```

**使用方式**：直接傳訊息給機器人。先選擇專案，再傳送 prompt。

| 指令 | 說明 |
|------|------|
| `/start` | 歡迎訊息 |
| `/project` | 列出可用專案 |
| `/project <名稱>` | 選擇專案 |
| `/result` | 取得最新任務結果 |
| `/status` | 查看執行中的任務 |
| `/clear` | 清除當前專案的工作階段 |
| `/help` | 顯示說明 |
| 任何訊息 | 執行 Claude Code（需先選擇專案）|
| 傳送圖片 | 將圖片附加到 prompt |
| 傳送語音 | 語音轉文字後作為 prompt（需要 Speechmatics）|

**審批**：機器人傳送帶有 Approve / Deny inline 按鈕的訊息。逾時：5 分鐘。

**注意**：Telegram 使用 long polling，不需要公開 URL。

---

### Email

使用任何支援 IMAP 和 SMTP 的 email 帳戶（Gmail、Outlook 等）。

Gmail 使用者：啟用[應用程式密碼](https://myaccount.google.com/apppasswords)（需先啟用兩步驟驗證）。

```env
EMAIL_USER=claude-bot@gmail.com
EMAIL_PASS=your_app_password
EMAIL_IMAP_HOST=imap.gmail.com        # 選填，以下為預設值
EMAIL_IMAP_PORT=993
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_ALLOWED_SENDERS=user@example.com,user2@example.com   # 選填：限制寄件者
```

**使用方式**：寄 email 到機器人信箱。在主旨中用方括號標示專案名稱。

| 動作 | 說明 |
|------|------|
| `主旨：[my-app] 修復登入 bug` | 在 `my-app` 資料夾中以 email 內文作為 prompt 執行 Claude Code |
| 內文：`/result` | 取得最新任務結果 |
| 內文：`/status` | 查看執行中的任務 |
| 內文：`/cancel` | 取消當前執行中的任務（工作階段保留）|
| 內文：`/clear` | 清除主旨中專案的工作階段 |
| 內文：`/help` | 顯示說明 |

**審批**：機器人寄出帶有 Approve / Deny 連結的 HTML 郵件。每個連結包含一次性 token。逾時：5 分鐘。

**注意**：Email 使用 IMAP IDLE 即時監聽收件匣。回覆郵件透過 `In-Reply-To` 和 `References` header 維持郵件串。

**遠端伺服器**：如果在遠端伺服器上運行，需設定 `PUBLIC_URL` 讓審批連結指向正確的位址：
```env
PUBLIC_URL=https://your-domain.com:3001
```

---

### Web UI

不需要外部帳號。Web UI 與 MCP 權限伺服器運行在同一個伺服器上。

```env
WEB_UI_ENABLED=true
WEB_UI_PASSWORD=your_secret_password   # 選填：不設定則無需密碼
```

**使用方式**：在瀏覽器開啟 `http://localhost:3001/`。從下拉選單選擇專案，然後輸入 prompt。

| 操作 | 說明 |
|------|------|
| 選擇專案下拉選單 | 選擇要操作的專案資料夾 |
| 輸入訊息 + 送出 | 以你的訊息作為 prompt 執行 Claude Code |
| Clear Session 按鈕 | 清除當前專案的工作階段 |

**審批**：當 Claude 需要執行危險工具時，瀏覽器會彈出審批視窗，包含 Approve / Deny 按鈕。逾時：120 秒。

**功能**：透過 WebSocket 即時串流、深色主題 UI、工具呼叫狀態追蹤。

**注意**：不需要公開 URL。Web UI 由現有的 Express 伺服器提供服務。

---

## 語音轉文字（Speechmatics）

LINE 和 Telegram 支援語音訊息。若要啟用語音轉文字，請加入 [Speechmatics](https://www.speechmatics.com/) API key：

```env
SPEECHMATICS_API_KEY=your_api_key
SPEECHMATICS_LANGUAGE=cmn    # 語言代碼（預設：cmn）。中英雙語可用 cmn_en。
```

支援的語言：`en`、`cmn`、`cmn_en`、`ja`、`ko`、`fr`、`de`、`es`，以及[更多語言](https://docs.speechmatics.com/speech-to-text/languages)。

語音訊息會先轉譯為文字，再作為 prompt 傳給 Claude Code。

## 工具審批系統

Claude Code 使用各種工具（讀取檔案、寫入檔案、執行指令等）。本機器人將工具分類如下：

**自動核准**（安全、唯讀）：
- `Read`、`Glob`、`Grep`、`LS`、`TodoRead`、`WebFetch`、`WebSearch`

**需要審批**（修改檔案系統或執行指令）：
- `Bash`、`Write`、`Edit`、`MultiEdit`、`NotebookEdit`、`TodoWrite`

**拒絕**（未知工具）：
- 不在以上列表中的工具預設拒絕

需要審批時，機器人會透過各平台原生方式發送審批提示，等待使用者核准或拒絕。若逾時未回應，工具將被拒絕。

| 平台 | 審批方式 | 逾時 |
|------|---------|------|
| Discord | 表情反應 (check/X) | 30 秒 |
| LINE | Postback 按鈕 | 5 分鐘 |
| Slack | 表情反應 (check/X) | 30 秒 |
| Telegram | Inline 鍵盤按鈕 | 5 分鐘 |
| Email | HTTP 連結點擊 | 5 分鐘 |
| Web UI | 瀏覽器彈窗 | 2 分鐘 |

### 自動核准工具

若要跳過特定工具的互動式審批，在 `.env` 中設定 `AUTO_APPROVE_TOOLS`：

```env
AUTO_APPROVE_TOOLS=Edit,Write
```

可設定的工具名稱：

| 工具 | 說明 |
|------|------|
| `Bash` | 執行 shell 指令 |
| `Write` | 建立或覆寫檔案 |
| `Edit` | 編輯現有檔案 |
| `MultiEdit` | 編輯檔案中的多個位置 |
| `TodoWrite` | 寫入待辦事項 |

以逗號分隔，區分大小寫。未列在此處的工具仍會遵循預設審批流程。

## 進階設定

```env
# MCP 伺服器 port（預設：3001）
MCP_SERVER_PORT=3001

# Claude 程序逾時秒數（預設：300，最大：43200 = 12 小時）
CLAUDE_PROCESS_TIMEOUT=300

# Discord/Slack 審批逾時秒數（預設：30）
MCP_APPROVAL_TIMEOUT=30

# 逾時預設行為：'allow' 或 'deny'（預設：deny）
MCP_DEFAULT_ON_TIMEOUT=deny

# LINE 審批逾時秒數（預設：300）
LINE_APPROVAL_TIMEOUT=300

# Telegram 審批逾時秒數（預設：300）
TELEGRAM_APPROVAL_TIMEOUT=300

# Email 審批逾時秒數（預設：300）
EMAIL_APPROVAL_TIMEOUT=300

# WebUI 審批逾時秒數（預設：120）
WEBUI_APPROVAL_TIMEOUT=120

# 自動核准特定工具，跳過互動式審批（逗號分隔）
# 可用：Bash, Write, Edit, MultiEdit, TodoWrite
# AUTO_APPROVE_TOOLS=Edit,Write
```

## 開發

### 專案結構

```
src/
├── index.ts                  # 進入點，初始化所有已啟用的平台
├── types/index.ts            # 共用型別定義
├── utils/config.ts           # 環境變數驗證
├── shared/
│   ├── shell.ts              # Claude CLI 指令建構
│   ├── process-runner.ts     # 產生並串流 Claude 程序
│   ├── base-permission-manager.ts  # 抽象審批邏輯
│   ├── permissions.ts        # 工具安全分類
│   └── speechmatics.ts      # 語音轉文字 API 整合
├── db/database.ts            # SQLite：工作階段 + 任務結果
├── mcp/server.ts             # Express.js MCP 權限伺服器
└── channel/
    ├── discord/              # Discord.js 機器人
    ├── line/                 # LINE webhook 處理
    ├── slack/                # Slack Bolt 機器人（Socket Mode）
    ├── telegram/             # Telegraf 機器人（Long Polling）
    ├── email/                # IMAP IDLE + SMTP
    └── webui/                # WebSocket + 靜態 HTML
```

每個 channel 目錄包含：
- `client.ts` — 機器人客戶端（事件處理、指令）
- `manager.ts` — Claude Code 工作階段/任務管理
- `permission-manager.ts` — 平台專用審批體驗
- `shell.ts` — 平台專用指令建構
- `messages.ts` — 訊息格式化
- `types.ts` — 型別定義

### 執行測試

```bash
npm run test:run    # 執行一次
npm test            # 監看模式
```

### 新增平台

1. 建立 `src/channel/<platform>/`，包含 6 個標準檔案
2. 在 `src/shared/shell.ts` 中將平台加入 `PlatformBridgeConfig.platform` 聯合型別
3. 在 `mcp-bridge.cjs` 中新增平台設定
4. 在 `src/mcp/server.ts` 中新增 MCP 路由
5. 在 `src/db/database.ts` 中新增資料表（若使用非同步任務模式）
6. 在 `src/utils/config.ts` 中新增設定驗證
7. 在 `src/index.ts` 中新增初始化邏輯

## 健康檢查

啟動後，MCP 伺服器提供健康檢查端點：

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

## 致謝

本專案最初受到 [@timoconnellaus](https://github.com/timoconnellaus) 的 [claude-code-discord-bot](https://github.com/timoconnellaus/claude-code-discord-bot) 啟發，Discord 整合的初始概念源自該專案。本 repo 後來經過大幅改寫與擴展，支援多平台（LINE、Slack、Telegram、Email、Web UI）、共用架構及許多額外功能。

## 授權

MIT License。詳見 [LICENSE](LICENSE)。
