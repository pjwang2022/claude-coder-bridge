import type { Telegraf } from 'telegraf';
import type { PendingTelegramApproval, TelegramContext } from './types.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { buildApprovalMessage } from './messages.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export class TelegramPermissionManager extends BasePermissionManager<TelegramContext, PendingTelegramApproval> {
  private bot?: Telegraf;

  constructor() {
    const timeoutMs = parseInt(process.env.TELEGRAM_APPROVAL_TIMEOUT || '300') * 1000;
    super(timeoutMs, 'deny');
  }

  setBot(bot: Telegraf): void {
    this.bot = bot;
  }

  protected async handleNoContext(
    _toolName: string,
    _input: any,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'No Telegram context available' };
  }

  protected createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: TelegramContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout,
  ): PendingTelegramApproval {
    return {
      requestId,
      toolName,
      input,
      telegramContext: context,
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  protected async sendApprovalRequest(pending: PendingTelegramApproval): Promise<void> {
    if (!this.bot) {
      throw new Error('Telegram bot not set');
    }

    const msg = buildApprovalMessage(pending.requestId, pending.toolName, pending.input);

    const sentMessage = await this.bot.telegram.sendMessage(
      pending.telegramContext.chatId,
      msg.text,
      {
        parse_mode: msg.parseMode,
        reply_markup: {
          inline_keyboard: msg.inlineKeyboard,
        },
      },
    );

    pending.approvalChatId = pending.telegramContext.chatId;
    pending.approvalMessageId = sentMessage.message_id;
  }

  protected async handleSendFailure(
    _pending: PendingTelegramApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'Failed to send approval request to Telegram' };
  }

  handleCallbackQuery(userId: number, data: string): void {
    const params = new URLSearchParams(data);
    const action = params.get('action');
    const requestId = params.get('requestId');

    if (!requestId || !action) return;
    if (action !== 'approve' && action !== 'deny') return;

    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      console.log(`TelegramPermissionManager: No pending approval for requestId ${requestId}`);
      return;
    }

    if (pending.telegramContext.userId !== userId) {
      console.log(`TelegramPermissionManager: Unauthorized user ${userId} for approval`);
      return;
    }

    clearTimeout(pending.timeout);

    const approved = action === 'approve';
    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pending.input : undefined,
      message: approved ? undefined : 'Denied by user via Telegram',
    };

    console.log(`TelegramPermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pending.toolName}`);

    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);

    // Edit message to remove buttons
    if (this.bot && pending.approvalChatId && pending.approvalMessageId) {
      const statusText = approved ? '✅ Approved' : '❌ Denied';
      this.bot.telegram.editMessageText(
        pending.approvalChatId,
        pending.approvalMessageId,
        undefined,
        `${statusText}: ${pending.toolName}`,
      ).catch(err => {
        console.error('TelegramPermissionManager: Failed to edit approval message:', err);
      });
    }
  }
}
