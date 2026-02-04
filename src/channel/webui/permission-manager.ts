import type { PendingWebUIApproval, WebUIContext } from './types.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { buildApprovalRequestPayload } from './messages.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export type SendFunction = (connectionId: string, payload: any) => void;

export class WebUIPermissionManager extends BasePermissionManager<WebUIContext, PendingWebUIApproval> {
  private sendFunction?: SendFunction;

  constructor() {
    const timeoutMs = parseInt(process.env.WEBUI_APPROVAL_TIMEOUT || '3600') * 1000;
    super(timeoutMs, 'deny');
  }

  setSendFunction(fn: SendFunction): void {
    this.sendFunction = fn;
  }

  protected async handleNoContext(
    _toolName: string,
    _input: any,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'No WebUI context available' };
  }

  protected createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: WebUIContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout | undefined,
  ): PendingWebUIApproval {
    return {
      requestId,
      toolName,
      input,
      webUIContext: context,
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  protected async sendApprovalRequest(pending: PendingWebUIApproval): Promise<void> {
    if (!this.sendFunction) {
      throw new Error('WebUI send function not set');
    }

    const payload = buildApprovalRequestPayload(
      pending.requestId,
      pending.toolName,
      pending.input,
    );

    this.sendFunction(pending.webUIContext.connectionId, payload);
  }

  protected async handleSendFailure(
    _pending: PendingWebUIApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'Failed to send approval request via WebSocket' };
  }

  handleApprovalResponse(requestId: string, approved: boolean): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      console.log(`WebUIPermissionManager: No pending approval for requestId ${requestId}`);
      return;
    }

    clearTimeout(pending.timeout);

    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pending.input : undefined,
      message: approved ? undefined : 'Denied by user via WebUI',
    };

    console.log(`WebUIPermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pending.toolName}`);

    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);
  }
}
