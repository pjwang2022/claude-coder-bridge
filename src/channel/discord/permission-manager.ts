import type { DiscordContext, PendingApproval } from './discord-context.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { formatToolForDiscord } from './discord-context.js';
import { approveToolRequest } from './permissions.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export class PermissionManager extends BasePermissionManager<DiscordContext, PendingApproval> {
  private discordBot: any = null;

  constructor() {
    const timeoutMs = parseInt(process.env.MCP_APPROVAL_TIMEOUT || '30') * 1000;
    const defaultOnTimeout = (process.env.MCP_DEFAULT_ON_TIMEOUT as 'allow' | 'deny') || 'deny';
    super(timeoutMs, defaultOnTimeout);
  }

  setDiscordBot(discordBot: any): void {
    this.discordBot = discordBot;
  }

  override async requestApproval(
    toolName: string,
    input: any,
    discordContext?: DiscordContext,
  ): Promise<PermissionDecision> {
    // If no Discord bot available, fall back to basic approval
    if (!this.discordBot) {
      return await approveToolRequest(toolName, input, discordContext);
    }

    return super.requestApproval(toolName, input, discordContext);
  }

  protected async handleNoContext(
    toolName: string,
    input: any,
  ): Promise<PermissionDecision> {
    return await approveToolRequest(toolName, input);
  }

  protected createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: DiscordContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout,
  ): PendingApproval {
    return {
      requestId,
      toolName,
      input,
      discordContext: context,
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  protected async sendApprovalRequest(pending: PendingApproval): Promise<void> {
    if (!this.discordBot) {
      throw new Error('No Discord bot available');
    }

    const channel = await this.discordBot.client.channels.fetch(pending.discordContext.channelId);
    if (!channel) {
      throw new Error(`Could not find Discord channel: ${pending.discordContext.channelId}`);
    }

    const toolInfo = formatToolForDiscord(pending.toolName, pending.input);
    const approvalMessage = `🔐 **Permission Required**\n\n${toolInfo}\n\n**Claude Code is requesting permission to use this tool.**\nReact with ✅ to approve or ❌ to deny.\n\n*Timeout in ${this.approvalTimeout / 1000} seconds (default: ${this.defaultOnTimeout})*`;

    const message = await channel.send(approvalMessage);
    await message.react('✅');
    await message.react('❌');

    pending.discordMessage = message;
    console.log(`PermissionManager: Sent approval message for ${pending.requestId}`);
  }

  protected async handleSendFailure(
    pending: PendingApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return await approveToolRequest(pending.toolName, pending.input, pending.discordContext);
  }

  handleApprovalReaction(channelId: string, messageId: string, userId: string, approved: boolean): void {
    let pendingApproval: PendingApproval | undefined;
    let requestId: string | undefined;

    for (const [id, approval] of this.pendingApprovals.entries()) {
      if (approval.discordContext.channelId === channelId &&
          approval.discordMessage?.id === messageId) {
        pendingApproval = approval;
        requestId = id;
        break;
      }
    }

    if (!pendingApproval || !requestId) {
      return;
    }

    if (userId !== pendingApproval.discordContext.userId) {
      console.log('PermissionManager: Unauthorized user attempted approval:', userId);
      return;
    }

    clearTimeout(pendingApproval.timeout);

    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pendingApproval.input : undefined,
      message: approved ? undefined : 'Denied by user via Discord reaction',
    };

    console.log(`PermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pendingApproval.toolName}`);
    pendingApproval.resolve(decision);
    this.cleanupPending(requestId);
    this.updateApprovalMessage(pendingApproval.discordMessage, approved).catch(console.error);
  }

  protected override handleTimeout(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    super.handleTimeout(requestId);
    if (pending) {
      this.updateApprovalMessage(pending.discordMessage, null).catch(console.error);
    }
  }

  private async updateApprovalMessage(message: any, approved: boolean | null): Promise<void> {
    if (!message) return;

    try {
      if (approved === true || approved === false) {
        await message.delete();
      } else {
        const statusText = `**TIMED OUT** - defaulted to ${this.defaultOnTimeout.toUpperCase()}`;
        const updatedContent = message.content + `\n\n⏰ ${statusText}`;
        await message.edit(updatedContent);
        await message.reactions.removeAll().catch(() => {});
        setTimeout(async () => {
          try { await message.delete(); } catch {}
        }, 5000);
      }
    } catch (error) {
      console.error('PermissionManager: Error updating approval message:', error);
    }
  }

  getStatus(): {
    pendingCount: number;
    pendingRequests: Array<{
      requestId: string;
      toolName: string;
      channelId: string;
      createdAt: Date;
    }>;
  } {
    const pendingRequests = Array.from(this.pendingApprovals.entries()).map(([requestId, approval]) => ({
      requestId,
      toolName: approval.toolName,
      channelId: approval.discordContext.channelId,
      createdAt: approval.createdAt,
    }));

    return {
      pendingCount: this.pendingApprovals.size,
      pendingRequests,
    };
  }
}
