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

  constructor() {
    const timeoutMs = parseInt(process.env.EMAIL_APPROVAL_TIMEOUT || '300') * 1000;
    super(timeoutMs, 'deny');
    const port = process.env.MCP_SERVER_PORT || '3001';
    this.baseUrl = `http://localhost:${port}`;
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

  protected async sendApprovalRequest(pending: PendingEmailApproval): Promise<void> {
    if (!this.transporter) {
      throw new Error('Email transporter not set');
    }

    const msg = buildApprovalEmail(
      pending.requestId,
      pending.approvalToken,
      pending.toolName,
      pending.input,
      this.baseUrl,
    );

    await this.transporter.sendMail({
      from: this.botEmail,
      to: pending.emailContext.from,
      subject: msg.subject,
      html: msg.html,
      inReplyTo: pending.emailContext.messageId,
      references: pending.emailContext.messageId,
    });
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

    const action = approved ? 'approved' : 'denied';
    return { success: true, message: `Tool "${pending.toolName}" has been ${action}.` };
  }
}
