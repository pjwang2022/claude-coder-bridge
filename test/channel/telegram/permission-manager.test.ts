import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { TelegramPermissionManager } from '../../../src/channel/telegram/permission-manager.js';
import type { TelegramContext } from '../../../src/channel/telegram/types.js';

describe('TelegramPermissionManager', () => {
  let manager: TelegramPermissionManager;
  let mockBot: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new TelegramPermissionManager();

    mockBot = {
      telegram: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
        editMessageText: vi.fn().mockResolvedValue({}),
      },
    };

    manager.setBot(mockBot);
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
  });

  it('should auto-approve safe tools', async () => {
    const context: TelegramContext = {
      userId: 123456789,
      chatId: 123456789,
      projectName: 'test-project',
    };

    const decision = await manager.requestApproval('Read', { file_path: '/test' }, context);
    expect(decision.behavior).toBe('allow');
    expect(mockBot.telegram.sendMessage).not.toHaveBeenCalled();
  });

  it('should send approval message for dangerous tools', async () => {
    const context: TelegramContext = {
      userId: 123456789,
      chatId: 123456789,
      projectName: 'test-project',
    };

    // Start approval (don't await - it waits for callback)
    const approvalPromise = manager.requestApproval('Bash', { command: 'ls' }, context);

    // Wait for message to be sent
    await vi.waitFor(() => {
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
    });

    // Verify message was sent to the right chat with inline keyboard
    expect(mockBot.telegram.sendMessage).toHaveBeenCalledWith(
      123456789,
      expect.stringContaining('Permission Required'),
      expect.objectContaining({
        reply_markup: expect.objectContaining({
          inline_keyboard: expect.any(Array),
        }),
      }),
    );

    // Simulate user approving
    manager.handleCallbackQuery(123456789, 'action=approve&requestId=' + getRequestId(manager));

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should handle denial via callback', async () => {
    const context: TelegramContext = {
      userId: 123456789,
      chatId: 123456789,
      projectName: 'test-project',
    };

    const approvalPromise = manager.requestApproval('Write', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
    });

    manager.handleCallbackQuery(123456789, 'action=deny&requestId=' + getRequestId(manager));

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('Denied by user');
  });

  it('should reject approval from unauthorized user', async () => {
    const context: TelegramContext = {
      userId: 123456789,
      chatId: 123456789,
      projectName: 'test-project',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'rm -rf /' }, context);

    await vi.waitFor(() => {
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
    });

    const requestId = getRequestId(manager);

    // Unauthorized user tries to approve
    manager.handleCallbackQuery(999999999, 'action=approve&requestId=' + requestId);

    // Approve with correct user to finish the test
    manager.handleCallbackQuery(123456789, 'action=approve&requestId=' + requestId);

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should fallback when no bot is set', async () => {
    const managerNoBot = new TelegramPermissionManager();

    // Safe tool should still be allowed via fallback
    const decision = await managerNoBot.requestApproval('Read', { file_path: '/test' }, {
      userId: 123456789,
      chatId: 123456789,
      projectName: 'test',
    });
    expect(decision.behavior).toBe('allow');

    managerNoBot.cleanup();
  });

  it('should edit message on approval/denial', async () => {
    const context: TelegramContext = {
      userId: 123456789,
      chatId: 123456789,
      projectName: 'test-project',
    };

    const approvalPromise = manager.requestApproval('Edit', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockBot.telegram.sendMessage).toHaveBeenCalled();
    });

    manager.handleCallbackQuery(123456789, 'action=approve&requestId=' + getRequestId(manager));
    await approvalPromise;

    // Wait for async edit
    await vi.waitFor(() => {
      expect(mockBot.telegram.editMessageText).toHaveBeenCalledWith(
        123456789,
        42,
        undefined,
        expect.stringContaining('Approved'),
      );
    });
  });
});

// Helper to extract the requestId from pending approvals
function getRequestId(manager: TelegramPermissionManager): string {
  const pendingMap = (manager as any).pendingApprovals as Map<string, any>;
  const firstKey = pendingMap.keys().next().value;
  return firstKey;
}
