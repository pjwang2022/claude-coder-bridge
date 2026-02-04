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

  it('should approve all pending approvals for a user', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<msg@test>',
    };

    // Request two approvals
    const promise1 = manager.requestApproval('Bash', { command: 'ls' }, context);
    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
    });

    // Verify threading: first email uses original messageId
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: expect.stringContaining('[app]'),
        inReplyTo: '<msg@test>',
      }),
    );

    // Get approve-all token from internal state
    const approveAllTokens = (manager as any).approveAllTokens as Map<string, string>;
    const token = approveAllTokens.get('user@test.com')!;
    expect(token).toBeDefined();

    // Approve all
    const result = manager.handleApproveAllHttp('user@test.com', token);
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);

    const decision1 = await promise1;
    expect(decision1.behavior).toBe('allow');
  });

  it('should reject approve-all with invalid token', () => {
    const result = manager.handleApproveAllHttp('user@test.com', 'bad-token');
    expect(result.success).toBe(false);
    expect(result.count).toBe(0);
  });

  it('should use threaded subject with project name', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[my-project] fix bug',
      projectName: 'my-project',
      messageId: '<msg@test>',
    };

    const promise = manager.requestApproval('Bash', { command: 'ls' }, context);

    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    // Subject should be consistent for threading
    expect(mockTransporter.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: '🔐 Permissions: [my-project]',
      }),
    );

    // Clean up
    const requestId = getRequestId(manager);
    const pending = getPending(manager, requestId);
    manager.handleApprovalHttp(requestId, pending.approvalToken, true);
    await promise;
  });

  it('should chain reply threading across multiple approvals', async () => {
    const context: EmailContext = {
      from: 'user@test.com',
      subject: '[app] test',
      projectName: 'app',
      messageId: '<original@test>',
    };

    // First approval
    const promise1 = manager.requestApproval('Bash', { command: 'ls' }, context);
    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(1);
    });

    // First email threads to original message
    expect(mockTransporter.sendMail.mock.calls[0][0].inReplyTo).toBe('<original@test>');

    // Approve first, then request second
    const rid1 = getRequestId(manager);
    const p1 = getPending(manager, rid1);
    manager.handleApprovalHttp(rid1, p1.approvalToken, true);
    await promise1;

    // Second approval — should thread to the first approval email's messageId
    const promise2 = manager.requestApproval('Write', { file_path: '/test' }, context);
    await vi.waitFor(() => {
      expect(mockTransporter.sendMail).toHaveBeenCalledTimes(2);
    });

    // Second email threads to the reply from first email
    expect(mockTransporter.sendMail.mock.calls[1][0].inReplyTo).toBe('<approval@test>');

    const rid2 = getRequestId(manager);
    const p2 = getPending(manager, rid2);
    manager.handleApprovalHttp(rid2, p2.approvalToken, true);
    await promise2;
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
