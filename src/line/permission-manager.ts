import type { PendingLineApproval, LineContext } from './types.js';
import type { PermissionDecision } from '../mcp/permissions.js';
import { requiresApproval, generateRequestId } from '../mcp/discord-context.js';
import { buildApprovalFlexMessage } from './messages.js';

export class LinePermissionManager {
  private pendingApprovals = new Map<string, PendingLineApproval>();
  private approvalTimeout: number;
  private defaultOnTimeout: 'allow' | 'deny';
  private channelAccessToken: string;

  constructor(channelAccessToken: string) {
    this.channelAccessToken = channelAccessToken;
    this.approvalTimeout = parseInt(process.env.LINE_APPROVAL_TIMEOUT || '300') * 1000;
    this.defaultOnTimeout = 'deny';
  }

  async requestApproval(
    toolName: string,
    input: any,
    lineContext?: LineContext
  ): Promise<PermissionDecision> {
    // No context — deny for safety
    if (!lineContext) {
      return { behavior: 'deny', message: 'No LINE context available' };
    }

    // Safe tools auto-approve
    if (!requiresApproval(toolName, input)) {
      return { behavior: 'allow', updatedInput: input };
    }

    return await this.requestInteractiveApproval(toolName, input, lineContext);
  }

  private async requestInteractiveApproval(
    toolName: string,
    input: any,
    lineContext: LineContext
  ): Promise<PermissionDecision> {
    const requestId = generateRequestId();

    return new Promise<PermissionDecision>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.handleTimeout(requestId);
      }, this.approvalTimeout);

      const pending: PendingLineApproval = {
        requestId,
        toolName,
        input,
        lineContext,
        resolve,
        reject,
        timeout,
        createdAt: new Date(),
      };

      this.pendingApprovals.set(requestId, pending);

      this.pushApprovalMessage(requestId, lineContext.userId, toolName, input)
        .catch((error) => {
          console.error('LinePermissionManager: Failed to push approval message:', error);
          this.cleanupPending(requestId);
          // Auto-deny if we can't even send the approval request
          resolve({ behavior: 'deny', message: 'Failed to send approval request to LINE' });
        });
    });
  }

  handlePostback(userId: string, data: string): void {
    const params = new URLSearchParams(data);
    const action = params.get('action');
    const requestId = params.get('requestId');

    if (!requestId || !action) return;
    if (action !== 'approve' && action !== 'deny') return;

    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      console.log(`LinePermissionManager: No pending approval for requestId ${requestId}`);
      return;
    }

    if (pending.lineContext.userId !== userId) {
      console.log(`LinePermissionManager: Unauthorized user ${userId} for approval`);
      return;
    }

    clearTimeout(pending.timeout);

    const approved = action === 'approve';
    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pending.input : undefined,
      message: approved ? undefined : 'Denied by user via LINE',
    };

    console.log(`LinePermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pending.toolName}`);

    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);
  }

  private handleTimeout(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;

    console.log(`LinePermissionManager: Approval timed out for ${pending.toolName}`);

    pending.resolve({
      behavior: this.defaultOnTimeout,
      message: `Timed out after ${this.approvalTimeout / 1000}s, defaulted to ${this.defaultOnTimeout}`,
    });

    this.pendingApprovals.delete(requestId);
  }

  private async pushApprovalMessage(
    requestId: string,
    userId: string,
    toolName: string,
    input: any
  ): Promise<void> {
    const flex = buildApprovalFlexMessage(requestId, toolName, input);

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: userId,
        messages: [flex],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE Push API error ${response.status}: ${errorBody}`);
    }
  }

  private cleanupPending(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(requestId);
    }
  }

  cleanup(): void {
    for (const [requestId, approval] of this.pendingApprovals.entries()) {
      clearTimeout(approval.timeout);
      approval.reject(new Error('LINE permission manager shutting down'));
    }
    this.pendingApprovals.clear();
  }
}
