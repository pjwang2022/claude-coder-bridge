import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { WebUIPermissionManager } from '../../../src/channel/webui/permission-manager.js';
import type { WebUIContext } from '../../../src/channel/webui/types.js';

describe('WebUIPermissionManager', () => {
  let manager: WebUIPermissionManager;
  let mockSend: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new WebUIPermissionManager();
    mockSend = vi.fn();
    manager.setSendFunction(mockSend);
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
  });

  it('should auto-approve safe tools', async () => {
    const context: WebUIContext = {
      connectionId: 'conn-1',
      project: 'my-app',
    };

    const decision = await manager.requestApproval('Read', { file_path: '/test' }, context);
    expect(decision.behavior).toBe('allow');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should send approval request via WebSocket for dangerous tools', async () => {
    const context: WebUIContext = {
      connectionId: 'conn-1',
      project: 'my-app',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'ls' }, context);

    await vi.waitFor(() => {
      expect(mockSend).toHaveBeenCalled();
    });

    // Verify send was called with correct payload
    expect(mockSend).toHaveBeenCalledWith(
      'conn-1',
      expect.objectContaining({
        type: 'approval_request',
        toolName: 'Bash',
        input: { command: 'ls' },
      }),
    );

    // Simulate user approval
    const requestId = getRequestId(manager);
    manager.handleApprovalResponse(requestId, true);

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should handle denial', async () => {
    const context: WebUIContext = {
      connectionId: 'conn-1',
      project: 'my-app',
    };

    const approvalPromise = manager.requestApproval('Write', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockSend).toHaveBeenCalled();
    });

    const requestId = getRequestId(manager);
    manager.handleApprovalResponse(requestId, false);

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('Denied by user');
  });

  it('should deny when no context is provided', async () => {
    const decision = await manager.requestApproval('Bash', { command: 'ls' });
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('No WebUI context');
  });

  it('should deny when no send function is set', async () => {
    const managerNoSend = new WebUIPermissionManager();

    const context: WebUIContext = {
      connectionId: 'conn-1',
      project: 'my-app',
    };

    const decision = await managerNoSend.requestApproval('Bash', { command: 'ls' }, context);
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('Failed to send');

    managerNoSend.cleanup();
  });

  it('should ignore unknown requestId in handleApprovalResponse', () => {
    // Should not throw
    manager.handleApprovalResponse('nonexistent', true);
  });
});

function getRequestId(manager: WebUIPermissionManager): string {
  const pendingMap = (manager as any).pendingApprovals as Map<string, any>;
  const firstKey = pendingMap.keys().next().value;
  return firstKey;
}
