import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('botbuilder', () => ({
  BotFrameworkAdapter: vi.fn(),
  TurnContext: vi.fn(),
  CardFactory: {
    adaptiveCard: vi.fn((card: any) => ({ contentType: 'application/vnd.microsoft.card.adaptive', content: card })),
  },
}));

import { TeamsPermissionManager } from '../../../src/channel/teams/permission-manager.js';
import type { TeamsContext } from '../../../src/channel/teams/types.js';

describe('TeamsPermissionManager', () => {
  let manager: TeamsPermissionManager;
  let mockAdapter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TeamsPermissionManager();

    mockAdapter = {
      continueConversation: vi.fn().mockImplementation(async (_ref: any, callback: any) => {
        const mockTurnContext = {
          sendActivity: vi.fn().mockResolvedValue({ id: 'activity-123' }),
        };
        await callback(mockTurnContext);
      }),
    };

    manager.setAdapter(mockAdapter);
    manager.storeConversationReference('user-1', { conversation: { id: 'conv-1' } } as any);
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
  });

  it('should auto-approve safe tools', async () => {
    const context: TeamsContext = {
      userId: 'user-1',
      conversationId: 'conv-1',
      serviceUrl: 'https://smba.test/',
      projectName: 'app',
    };

    const decision = await manager.requestApproval('Read', { file_path: '/test' }, context);
    expect(decision.behavior).toBe('allow');
    expect(mockAdapter.continueConversation).not.toHaveBeenCalled();
  });

  it('should send Adaptive Card for dangerous tools', async () => {
    const context: TeamsContext = {
      userId: 'user-1',
      conversationId: 'conv-1',
      serviceUrl: 'https://smba.test/',
      projectName: 'app',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'ls' }, context);

    await vi.waitFor(() => {
      expect(mockAdapter.continueConversation).toHaveBeenCalled();
    });

    // Simulate card action approval
    const requestId = getRequestId(manager);
    manager.handleCardAction('user-1', { action: 'approve', requestId });

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should handle denial via card action', async () => {
    const context: TeamsContext = {
      userId: 'user-1',
      conversationId: 'conv-1',
      serviceUrl: 'https://smba.test/',
      projectName: 'app',
    };

    const approvalPromise = manager.requestApproval('Write', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockAdapter.continueConversation).toHaveBeenCalled();
    });

    const requestId = getRequestId(manager);
    manager.handleCardAction('user-1', { action: 'deny', requestId });

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('Denied by user');
  });

  it('should reject approval from unauthorized user', async () => {
    const context: TeamsContext = {
      userId: 'user-1',
      conversationId: 'conv-1',
      serviceUrl: 'https://smba.test/',
      projectName: 'app',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'ls' }, context);

    await vi.waitFor(() => {
      expect(mockAdapter.continueConversation).toHaveBeenCalled();
    });

    const requestId = getRequestId(manager);

    // Try with wrong user - should not resolve
    manager.handleCardAction('wrong-user', { action: 'approve', requestId });

    // Verify still pending
    const pendingMap = (manager as any).pendingApprovals as Map<string, any>;
    expect(pendingMap.has(requestId)).toBe(true);

    // Approve with correct user to finish
    manager.handleCardAction('user-1', { action: 'approve', requestId });
    await approvalPromise;
  });

  it('should deny when no context is provided', async () => {
    const decision = await manager.requestApproval('Bash', { command: 'ls' });
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('No Teams context');
  });

  it('should ignore unknown requestId in handleCardAction', () => {
    // Should not throw
    manager.handleCardAction('user-1', { action: 'approve', requestId: 'nonexistent' });
  });
});

function getRequestId(manager: TeamsPermissionManager): string {
  const pendingMap = (manager as any).pendingApprovals as Map<string, any>;
  const firstKey = pendingMap.keys().next().value;
  return firstKey;
}
