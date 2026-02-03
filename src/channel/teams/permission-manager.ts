import {
  BotFrameworkAdapter,
  TurnContext,
  CardFactory,
  type ConversationReference,
} from 'botbuilder';
import type { PendingTeamsApproval, TeamsContext } from './types.js';
import type { PermissionDecision } from '../../shared/permissions.js';
import { buildApprovalCard } from './messages.js';
import { BasePermissionManager } from '../../shared/base-permission-manager.js';

export class TeamsPermissionManager extends BasePermissionManager<TeamsContext, PendingTeamsApproval> {
  private adapter?: BotFrameworkAdapter;
  private conversationRefs = new Map<string, Partial<ConversationReference>>();

  constructor() {
    const timeoutMs = parseInt(process.env.TEAMS_APPROVAL_TIMEOUT || '300') * 1000;
    super(timeoutMs, 'deny');
  }

  setAdapter(adapter: BotFrameworkAdapter): void {
    this.adapter = adapter;
  }

  storeConversationReference(userId: string, ref: Partial<ConversationReference>): void {
    this.conversationRefs.set(userId, ref);
  }

  protected async handleNoContext(
    _toolName: string,
    _input: any,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'No Teams context available' };
  }

  protected createPendingApproval(
    requestId: string,
    toolName: string,
    input: any,
    context: TeamsContext,
    resolve: (decision: PermissionDecision) => void,
    reject: (error: Error) => void,
    timeout: NodeJS.Timeout,
  ): PendingTeamsApproval {
    return {
      requestId,
      toolName,
      input,
      teamsContext: context,
      resolve,
      reject,
      timeout,
      createdAt: new Date(),
    };
  }

  protected async sendApprovalRequest(pending: PendingTeamsApproval): Promise<void> {
    if (!this.adapter) {
      throw new Error('Teams adapter not set');
    }

    const ref = this.conversationRefs.get(pending.teamsContext.userId);
    if (!ref) {
      throw new Error(`No conversation reference for user ${pending.teamsContext.userId}`);
    }

    const card = buildApprovalCard(pending.requestId, pending.toolName, pending.input);

    await this.adapter.continueConversation(ref, async (turnContext: TurnContext) => {
      const activity = await turnContext.sendActivity({
        attachments: [CardFactory.adaptiveCard(card)],
      });
      if (activity?.id) {
        pending.approvalActivityId = activity.id;
      }
    });
  }

  protected async handleSendFailure(
    _pending: PendingTeamsApproval,
    _error: Error,
  ): Promise<PermissionDecision> {
    return { behavior: 'deny', message: 'Failed to send approval request to Teams' };
  }

  handleCardAction(userId: string, data: any): void {
    const { action, requestId } = data;
    if (!requestId || !action) return;
    if (action !== 'approve' && action !== 'deny') return;

    const pending = this.pendingApprovals.get(requestId);
    if (!pending) {
      console.log(`TeamsPermissionManager: No pending approval for requestId ${requestId}`);
      return;
    }

    if (pending.teamsContext.userId !== userId) {
      console.log(`TeamsPermissionManager: Unauthorized user ${userId} for approval`);
      return;
    }

    clearTimeout(pending.timeout);

    const approved = action === 'approve';
    const decision: PermissionDecision = {
      behavior: approved ? 'allow' : 'deny',
      updatedInput: approved ? pending.input : undefined,
      message: approved ? undefined : 'Denied by user via Teams',
    };

    console.log(`TeamsPermissionManager: User ${approved ? 'approved' : 'denied'} tool ${pending.toolName}`);

    pending.resolve(decision);
    this.pendingApprovals.delete(requestId);
  }
}
