import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EmailPermissionManager } from '../../../src/channel/email/permission-manager.js';
import type { EmailContext } from '../../../src/channel/email/types.js';

describe('EmailPermissionManager', () => {
  let manager: EmailPermissionManager;
  let mockTransporter: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new EmailPermissionManager();

    mockTransporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: '<approval@test>' }),
    };

    manager.setTransporter(mockTransporter);
    manager.setBotEmail('bot@test.com');
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
  });

  it('should auto-approve safe tools', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<msg@test>',
    };

    const decision = await manager.requestApproval('Read', { file_path: '/test' }, context);
    expect(decision.behavior).toBe('allow');
    expect(mockTransporter.sendMail).not.toHaveBeenCalled();
  });

  it('should send approval email for dangerous tools', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<msg@test>',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'ls' }, context);

    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    // Verify approval email was sent
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'bot@test.com',
        to: 'user@test.com',
        inReplyTo: '<msg@test>',
        references: '<msg@test>',
      }),
    );

    // Simulate HTTP approval
    const requestId = getRequestId(manager);
    const pending = getPending(manager, requestId);
    const result = manager.handleApprovalHttp(requestId, pending.approvalToken, true);

    expect(result.success).toBe(true);
    expect(result.message).toContain('approved');

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should handle denial via HTTP', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<msg@test>',
    };

    const approvalPromise = manager.requestApproval('Write', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    const requestId = getRequestId(manager);
    const pending = getPending(manager, requestId);
    const result = manager.handleApprovalHttp(requestId, pending.approvalToken, false);

    expect(result.success).toBe(true);
    expect(result.message).toContain('denied');

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('Denied by user');
  });

  it('should reject invalid token', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<msg@test>',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'rm -rf /' }, context);

    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    const requestId = getRequestId(manager);

    // Try with wrong token
    const result = manager.handleApprovalHttp(requestId, 'wrong-token', true);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Invalid token');

    // Approve with correct token to finish the test
    const pending = getPending(manager, requestId);
    manager.handleApprovalHttp(requestId, pending.approvalToken, true);
    await approvalPromise;
  });

  it('should reject unknown request ID', () => {
    const result = manager.handleApprovalHttp('nonexistent', 'token', true);
    expect(result.success).toBe(false);
    expect(result.message).toContain('not found');
  });

  it('should deny when no transporter is set', async () => {
    const managerNoTransporter = new EmailPermissionManager();

    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<msg@test>',
    };

    // Safe tool should still be allowed
    const decision = await managerNoTransporter.requestApproval('Read', { file_path: '/test' }, context);
    expect(decision.behavior).toBe('allow');

    managerNoTransporter.cleanup();
  });
});

function getRequestId(manager: EmailPermissionManager): string {
  const pendingMap = (manager as any).pendingApprovals as Map<string, any>;
  const firstKey = pendingMap.keys().next().value;
  return firstKey;
}

function getPending(manager: EmailPermissionManager, requestId: string): any {
  const pendingMap = (manager as any).pendingApprovals as Map<string, any>;
  return pendingMap.get(requestId);
}
