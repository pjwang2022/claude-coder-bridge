# 變更紀錄

## 2026-02-03 — 跨 Channel 一致性修復

### 背景

WebUI 開發過程中建立了多個 shared 模組（`message-truncator`、`file-validator` 等），但 LINE、Telegram、Teams、Email 四個 channel 並未完全採用，導致行為不一致。本次修復統一各 channel 對 shared 模組的使用方式。

### 問題與修復

#### 1. 結果截斷不保存完整版（LINE / Telegram / Teams / Email）

**問題：** Discord 和 Slack 使用 shared `truncateWithSave()` 截斷時會將完整結果寫入 `.claude-result.md`，其他四個 channel 的 `messages.ts` 中各自實作了簡易 `truncate()`，只做字串截斷不保存完整版，使用者看到截斷訊息後無法取得完整回應。

**修復：** 在四個 channel 的 `manager.ts` 的 `onResult` callback 中，建完 `resultData` 後、寫入 DB 前，加入 `truncateWithSave()` 呼叫。DB 中存截斷後的文字，完整版保存至專案目錄下 `.claude-result.md`。`messages.ts` 中的本地截斷保持不動，作為顯示層的二次保護。

| 檔案 | 平台限制 |
|------|---------|
| `src/channel/line/manager.ts` | 1,400 字元 |
| `src/channel/telegram/manager.ts` | 2,900 字元 |
| `src/channel/teams/manager.ts` | 900 字元 |
| `src/channel/email/manager.ts` | 5,000 字元 |

#### 2. Slack 權限清單缺少 TodoWrite

**問題：** `src/channel/slack/permissions.ts` 的 `isDangerousTool()` 定義了 `['Bash', 'Write', 'Edit', 'MultiEdit']`，但 `src/shared/permissions.ts` 的 `requiresApproval()` 多包含了 `TodoWrite`。Slack 的 fallback 路徑可能誤將 `TodoWrite` 視為未知工具而非危險工具。

**修復：** 在 `src/channel/slack/permissions.ts` 的 `isDangerousTool()` 清單中補上 `'TodoWrite'`。

#### 3. LINE / Telegram 缺少檔案驗證

**問題：** Discord、Slack、WebUI、Teams、Email 的 client 都使用 `validateFile()` 驗證上傳檔案（副檔名、大小），LINE 和 Telegram 接收到附件後直接處理，沒有驗證。

**修復：**

| 檔案 | 驗證時機 | 說明 |
|------|---------|------|
| `src/channel/line/bot.ts` | 下載後、處理前 | LINE webhook 不提供檔案大小，只能下載後用 `buffer.length` 驗證 |
| `src/channel/telegram/client.ts` | 下載前 | Telegram 的 photo/voice 物件提供 `file_size`，可在下載前驗證，節省頻寬 |

驗證涵蓋 audio（`handleAudioMessage` / `handleVoice`）和 image（`handleImageMessage` / `handlePhoto`）兩種類型。

### 改動檔案一覽

| 檔案 | 變更類型 |
|------|---------|
| `src/channel/line/manager.ts` | 新增 `truncateWithSave` import 及呼叫 |
| `src/channel/telegram/manager.ts` | 同上 |
| `src/channel/teams/manager.ts` | 同上 |
| `src/channel/email/manager.ts` | 同上 |
| `src/channel/slack/permissions.ts` | `isDangerousTool` 補上 `TodoWrite` |
| `src/channel/line/bot.ts` | 新增 `validateFile` import 及 audio/image 驗證 |
| `src/channel/telegram/client.ts` | 新增 `validateFile` import 及 photo/voice 驗證 |

### 測試結果

全部 231 個測試通過，無 regression。

```
 Test Files  28 passed (28)
      Tests  231 passed (231)
```

---

## 2026-02-03 — Discord + LINE 重構：消除重複程式碼

### 背景

專案同時支援 Discord 和 LINE 兩個平台，但兩邊有大量重複的程式碼。本次重構建立共用抽象層，將重複率 85-95% 的程式碼統一管理。

### 改動摘要

淨減少約 **1,200 行**程式碼（刪 1,688 行、新增 486 行），同時功能完全不變。

### 新增檔案

| 檔案 | 用途 |
|------|------|
| `src/shared/permissions.ts` | 共用的 `PermissionDecision` 型別、`generateRequestId()`、`requiresApproval()` |
| `src/shared/shell.ts` | 共用的 `escapeShellString()`、`buildClaudeCommandCore()`、MCP 設定檔產生與清理 |
| `src/shared/base-permission-manager.ts` | `BasePermissionManager<TContext, TPending>` 抽象基底類別，包含審批流程、逾時處理、清理邏輯 |

### 刪除檔案

| 檔案 | 原因 |
|------|------|
| `line-mcp-bridge.cjs` | 與 `mcp-bridge.cjs` 95% 相同，已合併為單一腳本 |

### 改動明細

#### 1. MCP Bridge 合併（原本重複率 95%）

`mcp-bridge.cjs` 改為透過 `PLATFORM` 環境變數（`discord` 或 `line`）決定行為：
- 使用哪個 HTTP 路徑（`/mcp` vs `/line/mcp`）
- 傳送哪些 HTTP 標頭（Discord 的 channel/user ID vs LINE 的 user/project）

#### 2. Shell 指令建構統一（原本重複率 85%）

`src/shared/shell.ts` 提供 `buildClaudeCommandCore()` 函式，接受 `PlatformBridgeConfig`：

```typescript
interface PlatformBridgeConfig {
  platform: 'discord' | 'line';
  mcpServerName: string;       // "discord-permissions" | "line-permissions"
  permissionToolFqn: string;   // MCP 工具全名
  allowedToolsPrefix: string;  // --allowedTools 前綴
  envVars: Record<string, string>;
  configFilePrefix: string;    // 暫存檔前綴
}
```

`src/utils/shell.ts`（Discord）和 `src/line/shell.ts`（LINE）變成薄 wrapper，僅填入平台設定後委派給共用函式。

#### 3. Permission Manager 抽象基底類別（原本重複率 85%）

`BasePermissionManager<TContext, TPending>` 封裝共用邏輯：
- `requestApproval()` 流程：檢查 context → 檢查安全工具 → 互動式審批
- `requestInteractiveApproval()`：產生 ID、建立 Promise、設定逾時、發送審批請求
- `handleTimeout()`、`cleanupPending()`、`cleanup()`

Discord 和 LINE 各自實作四個抽象方法：
- `handleNoContext()` — 沒有平台 context 時的處理
- `createPendingApproval()` — 建立平台特定的待審批物件
- `sendApprovalRequest()` — 發送審批訊息（Discord 用 reaction、LINE 用 Flex Message）
- `handleSendFailure()` — 發送失敗時的回退策略

`PendingApproval` 和 `PendingLineApproval` 介面改為繼承 `PendingApprovalBase`。

#### 4. MCP Server 路由去重（原本重複率 85%）

`src/mcp/server.ts` 新增 `createMcpHandler()` 工廠方法：

```typescript
private createMcpHandler(
  serverName: string,
  extractContext: (req) => any | undefined,
  resolveApproval: (toolName, input, context) => Promise<PermissionDecision>,
): RequestHandler
```

`/mcp` 和 `/line/mcp` 兩個路由都使用同一個工廠，只傳入不同的 context 擷取函式和 permission manager。

#### 5. Discord Manager 改用 process-runner

`src/claude/manager.ts` 原本有 ~130 行的 inline `spawn` + buffer + JSON 解析邏輯，與 `src/claude/process-runner.ts`（LINE 已使用）完全重複。

改為呼叫 `spawnClaudeProcess()` 搭配 callbacks，Discord 特有的 Embed 訊息處理方法（`handleInitMessage`、`handleAssistantMessage` 等）維持不變，僅 process 管理層改為使用共用的 process-runner。

內部的 `channelProcesses` Map 從存放原始 `process` 物件改為存放 `ProcessHandle`（有 `kill()` 和 `pid`）。

#### 6. 向後相容

- `src/mcp/discord-context.ts` 和 `src/mcp/permissions.ts` 保留 re-export，外部 import 路徑不需要改
- `escapeShellString` 和 `buildClaudeCommand` 的函式簽名不變
- 所有公開 API 介面不變

### 測試結果

全部 52 個測試通過，無新增 TypeScript 錯誤。

```
 Test Files  7 passed (7)
      Tests  52 passed (52)
```
