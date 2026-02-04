import type { WebClient } from '@slack/web-api';
import type { SlackContext, PendingSlackApproval } from './slack-context.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { formatToolForSlack } from './slack-context.js';
import { approveToolRequest } from './permissions.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export class SlackPermissionManager extends BasePermissionManager<SlackContext, PendingSlackApproval> {
  private slackClient: WebClient | null = null;

  constructor() {
    const timeoutMs = parseInt(process.env.MCP_APPROVAL_TIMEOUT || '3600') * 1000;
    const defaultOnTimeout = (process.env.MCP_DEFAULT_ON_TIMEOUT as 'allow' | 'deny') || 'deny';
    super(timeoutMs, defaultOnTimeout);
  }

  setSlackClient(client: WebClient): void {
    this.slackClient = client;
  }

  override async requestApproval(
    toolName: string,
    input: any,
    slackContext?: SlackContext,
  ): Promise<PermissionDecision> {
    if (!this.slackClient) {
      return await approveToolRequest(toolName, input, slackContext);
    }

    return super.requestApproval(toolName, input, slackContext);
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
    context: SlackContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout | undefined,
  ): PendingSlackApproval {
    return {
      requestId,
      toolName,
      input,
      slackContext: context,
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  protected async sendApprovalRequest(pending: PendingSlackApproval): Promise<void> {
    if (!this.slackClient) {
      throw new Error('No Slack client available');
    }

    const toolInfo = formatToolForSlack(pending.toolName, pending.input);
    const text = `:lock: *Permission Required*\n\n${toolInfo}\n\n*Claude Code is requesting permission to use this tool.*\nReact with :white_check_mark: to approve or :x: to deny.\n\n_Timeout in ${this.approvalTimeout / 1000} seconds (default: ${this.defaultOnTimeout})_`;

    const result = await this.slackClient.chat.postMessage({
      channel: pending.slackContext.channelId,
      text,
    });

    if (result.ts) {
      pending.approvalChannelId = pending.slackContext.channelId;
      pending.approvalMessageTs = result.ts;

      await this.slackClient.reactions.add({
        channel: pending.slackContext.channelId,
        timestamp: result.ts,
        name: 'white_check_mark',
      });
      await this.slackClient.reactions.add({
        channel: pending.slackContext.channelId,
        timestamp: result.ts,
        name: 'x',
      });
    }

    console.log(`SlackPermissionManager: Sent approval message for ${pending.requestId}`);
  }

  protected async handleSendFailure(
    pending: PendingSlackApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return await approveToolRequest(pending.toolName, pending.input, pending.slackContext);
  }

  handleApprovalReaction(channelId: string, messageTs: string, userId: string, approved: boolean): void {
    let pendingApproval: PendingSlackApproval | undefined;
    let requestId: string | undefined;

    for (const [id, approval] of this.pendingApprovals.entries()) {
      if (approval.approvalChannelId === channelId &&
          approval.approvalMessageTs === messageTs) {
        pendingApproval = approval;
        requestId = id;
        break;
      }
    }

    if (!pendingApproval || !requestId) {
      return;
    }

    if (userId !== pendingApproval.slackContext.userId) {
      console.log('SlackPermissionManager: Unauthorized user attempted approval:', userId);
      return;
    }

    clearTimeout(pendingApproval.timeout);

    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pendingApproval.input : undefined,
      message: approved ? undefined : 'Denied by user via Slack reaction',
    };

    console.log(`SlackPermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pendingApproval.toolName}`);
    pendingApproval.resolve(decision);
    this.cleanupPending(requestId);
    this.updateApprovalMessage(
      pendingApproval.approvalChannelId,
      pendingApproval.approvalMessageTs,
      approved,
    ).catch(console.error);
  }

  protected override handleTimeout(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    super.handleTimeout(requestId);
    if (pending) {
      this.updateApprovalMessage(
        pending.approvalChannelId,
        pending.approvalMessageTs,
        null,
      ).catch(console.error);
    }
  }

  private async updateApprovalMessage(
    channelId?: string,
    messageTs?: string,
    approved: boolean | null = null,
  ): Promise<void> {
    if (!this.slackClient || !channelId || !messageTs) return;

    try {
      if (approved === true || approved === false) {
        await this.slackClient.chat.delete({
          channel: channelId,
          ts: messageTs,
        });
      } else {
        // Timeout — update message then delete after delay
        const statusText = `*TIMED OUT* - defaulted to ${this.defaultOnTimeout.toUpperCase()}`;
        await this.slackClient.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `:alarm_clock: ${statusText}`,
        });
        setTimeout(async () => {
          try {
            await this.slackClient!.chat.delete({ channel: channelId, ts: messageTs });
          } catch { /* ignore */ }
        }, 5000);
      }
    } catch (error) {
      console.error('SlackPermissionManager: Error updating approval message:', error);
    }
  }
}
