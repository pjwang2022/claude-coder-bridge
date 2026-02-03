import type { PendingLineApproval, LineContext } from './types.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { buildApprovalFlexMessage } from './messages.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export class LinePermissionManager extends BasePermissionManager<LineContext, PendingLineApproval> {
  private channelAccessToken: string;

  constructor(channelAccessToken: string) {
    const timeoutMs = parseInt(process.env.LINE_APPROVAL_TIMEOUT || '300') * 1000;
    super(timeoutMs, 'deny');
    this.channelAccessToken = channelAccessToken;
  }

  protected async handleNoContext(
    _toolName: string,
    _input: any,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'No LINE context available' };
  }

  protected createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: LineContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout,
  ): PendingLineApproval {
    return {
      requestId,
      toolName,
      input,
      lineContext: context,
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  protected async sendApprovalRequest(pending: PendingLineApproval): Promise<void> {
    const flex = buildApprovalFlexMessage(pending.requestId, pending.toolName, pending.input);

    const response = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.channelAccessToken}`,
      },
      body: JSON.stringify({
        to: pending.lineContext.userId,
        messages: [flex],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`LINE Push API error ${response.status}: ${errorBody}`);
    }
  }

  protected async handleSendFailure(
    _pending: PendingLineApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'Failed to send approval request to LINE' };
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
}
