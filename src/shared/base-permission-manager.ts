import type { PermissionDecision } from './permissions.js';
import { generateRequestId, requiresApproval } from './permissions.js';

export interface PendingApprovalBase {
  requestId: string;
  toolName: string;
  input: any;
  resolve: (decision: PermissionDecision) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout | undefined;
  createdAt: Date;
}

export abstract class BasePermissionManager<TContext, TPending extends PendingApprovalBase> {
  protected pendingApprovals = new Map<string, TPending>();
  protected approvalTimeout: number;
  protected defaultOnTimeout: 'allow' | 'deny';

  constructor(approvalTimeoutMs: number, defaultOnTimeout: 'allow' | 'deny' = 'deny') {
    this.approvalTimeout = approvalTimeoutMs;
    this.defaultOnTimeout = defaultOnTimeout;
  }

  async requestApproval(
    toolName: string,
    input: any,
    context?: TContext,
  ): Promise<PermissionDecision> {
    if (!context) {
      return this.handleNoContext(toolName, input);
    }

    if (!requiresApproval(toolName, input)) {
      return { behavior: 'allow', updatedInput: input };
    }

    return this.requestInteractiveApproval(toolName, input, context);
  }

  protected abstract handleNoContext(
    toolName: string,
    input: any,
  ): Promise<PermissionDecision>;

  protected abstract createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: TContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout | undefined,
  ): TPending;

  protected abstract sendApprovalRequest(pending: TPending): Promise<void>;

  protected abstract handleSendFailure(
    pending: TPending,
    error: Error,
  ): Promise<PermissionDecision>;

  private async requestInteractiveApproval(
    toolName: string,
    input: any,
    context: TContext,
  ): Promise<PermissionDecision> {
    const requestId = generateRequestId();

    return new Promise<PermissionDecision>((resolve) => {
      const timeout = this.approvalTimeout > 0
        ? setTimeout(() => { this.handleTimeout(requestId); }, this.approvalTimeout)
        : undefined;

      const pending = this.createPendingApproval(
        requestId, toolName, input, context, resolve, () => {}, timeout,
      );

      this.pendingApprovals.set(requestId, pending);

      this.sendApprovalRequest(pending).catch(async (error) => {
        console.error(`${this.constructor.name}: Failed to send approval request:`, error);
        this.cleanupPending(requestId);
        resolve(await this.handleSendFailure(pending, error));
      });
    });
  }

  protected handleTimeout(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) return;

    console.log(`${this.constructor.name}: Approval timed out for ${pending.toolName}`);

    pending.resolve({
      behavior: this.defaultOnTimeout,
      updatedInput: this.defaultOnTimeout === 'allow' ? pending.input : undefined,
      message: `Timed out after ${this.approvalTimeout / 1000}s, defaulted to ${this.defaultOnTimeout}`,
    });

    this.pendingApprovals.delete(requestId);
  }

  protected cleanupPending(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingApprovals.delete(requestId);
    }
  }

  cleanup(): void {
    for (const [, approval] of this.pendingApprovals.entries()) {
      clearTimeout(approval.timeout);
      approval.reject(new Error(`${this.constructor.name} shutting down`));
    }
    this.pendingApprovals.clear();
  }
}
