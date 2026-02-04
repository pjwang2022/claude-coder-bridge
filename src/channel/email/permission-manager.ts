import * as crypto from 'crypto';
import type { Transporter } from 'nodemailer';
import type { PendingEmailApproval, EmailContext } from './types.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { buildApprovalEmail } from './messages.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export class EmailPermissionManager extends BasePermissionManager<EmailContext, PendingEmailApproval> {
  private transporter?: Transporter;
  private botEmail: string = '';
  private baseUrl: string;
  // Threading: track last sent messageId per user so replies chain together
  private threadMap = new Map<string, string>();
  // Approve-all: per-user token for bulk approval
  private approveAllTokens = new Map<string, string>();

  constructor() {
    const timeoutMs = parseInt(process.env.EMAIL_APPROVAL_TIMEOUT || '300') * 1000;
    super(timeoutMs, 'deny');
    const port = process.env.MCP_SERVER_PORT || '3001';
    this.baseUrl = process.env.PUBLIC_URL || `http://localhost:${port}`;
  }

  setTransporter(transporter: Transporter): void {
    this.transporter = transporter;
  }

  setBotEmail(email: string): void {
    this.botEmail = email;
  }

  protected async handleNoContext(
    _toolName: string,
    _input: any,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'No Email context available' };
  }

  protected createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: EmailContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout,
  ): PendingEmailApproval {
    return {
      requestId,
      toolName,
      input,
      emailContext: context,
      approvalToken: crypto.randomUUID(),
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  private getApproveAllToken(userEmail: string): string {
    let token = this.approveAllTokens.get(userEmail);
    if (!token) {
      token = crypto.randomUUID();
      this.approveAllTokens.set(userEmail, token);
    }
    return token;
  }

  protected async sendApprovalRequest(pending: PendingEmailApproval): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not set');
    }

    const userEmail = pending.emailContext.from;
    const projectName = pending.emailContext.projectName;
    const approveAllToken = this.getApproveAllToken(userEmail);

    const approveAllUrl = `${this.baseUrl}/email/approve-all?from=${encodeURIComponent(userEmail)}&token=${encodeURIComponent(approveAllToken)}`;
    const msg = buildApprovalEmail(
      pending.requestId,
      pending.approvalToken,
      pending.toolName,
      pending.input,
      this.baseUrl,
      approveAllUrl,
    );

    // Thread: use last sent messageId for this user, or fall back to original email messageId
    const threadRef = this.threadMap.get(userEmail) || pending.emailContext.messageId;

    const result = await this.transporter.sendMail({
      from: this.botEmail,
      to: userEmail,
      subject: `🔐 Permissions: [${projectName}]`,
      html: msg.html,
      ...(threadRef ? { inReplyTo: threadRef, references: threadRef } : {}),
    });

    // Store this email's messageId for the next reply in the chain
    if (result.messageId) {
      this.threadMap.set(userEmail, result.messageId);
    }
  }

  protected async handleSendFailure(
    _pending: PendingEmailApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'Failed to send approval email' };
  }

  handleApprovalHttp(requestId: string, token: string, approved: boolean): { success: boolean; message: string } {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      return { success: false, message: 'Approval request not found or already handled.' };
    }

    if (pending.approvalToken !== token) {
      return { success: false, message: 'Invalid token.' };
    }

    clearTimeout(pending.timeout);

    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pending.input : undefined,
      message: approved ? undefined : 'Denied by user via email',
    };

    console.log(`EmailPermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pending.toolName}`);

    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);

    // Clean up thread/token maps if no more pending approvals for this user
    this.cleanupUserMaps(pending.emailContext.from);

    const action = approved ? 'approved' : 'denied';
    return { success: true, message: `Tool "${pending.toolName}" has been ${action}.` };
  }

  handleApproveAllHttp(from: string, token: string): { success: boolean; message: string; count: number } {
    const expectedToken = this.approveAllTokens.get(from);
    if (!expectedToken || expectedToken !== token) {
      return { success: false, message: 'Invalid or expired token.', count: 0 };
    }

    let count = 0;
    for (const [requestId, pending] of this.pendingApprovals.entries()) {
      if (pending.emailContext.from === from) {
        clearTimeout(pending.timeout);
        pending.resolve({
          behavior: 'allow',
          updatedInput: pending.input,
        });
        this.pendingApprovals.delete(requestId);
        console.log(`EmailPermissionManager: Bulk-approved tool ${pending.toolName}`);
        count++;
      }
    }

    this.cleanupUserMaps(from);

    if (count === 0) {
      return { success: false, message: 'No pending approvals found.', count: 0 };
    }

    return { success: true, message: `Approved ${count} pending tool(s).`, count };
  }

  private cleanupUserMaps(userEmail: string): void {
    const hasMore = Array.from(this.pendingApprovals.values())
      .some(p => p.emailContext.from === userEmail);
    if (!hasMore) {
      // Only clean approve-all token; keep threadMap so subsequent
      // approvals in the same session still chain as replies
      this.approveAllTokens.delete(userEmail);
    }
  }
}
