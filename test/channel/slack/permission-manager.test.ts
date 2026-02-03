import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { SlackPermissionManager } from '../../../src/channel/slack/permission-manager.js';
import type { SlackContext } from '../../../src/channel/slack/slack-context.js';

describe('SlackPermissionManager', () => {
  let manager: SlackPermissionManager;
  let mockClient: any;

  beforeEach(() => {
    vi.clearAllMocks();
    manager = new SlackPermissionManager();

    mockClient = {
      chat: {
        postMessage: vi.fn().mockResolvedValue({ ts: 'approval-ts-001' }),
        update: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      reactions: {
        add: vi.fn().mockResolvedValue({}),
      },
    };

    manager.setSlackClient(mockClient);
  });

  afterEach(() => {
    manager.cleanup();
    vi.restoreAllMocks();
  });

  it('should auto-approve safe tools', async () => {
    const context: SlackContext = {
      channelId: 'C123',
      channelName: 'test',
      userId: 'U456',
    };

    const decision = await manager.requestApproval('Read', { file_path: '/test' }, context);
    expect(decision.behavior).toBe('allow');
    expect(mockClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('should send approval message for dangerous tools', async () => {
    const context: SlackContext = {
      channelId: 'C123',
      channelName: 'test',
      userId: 'U456',
    };

    // Start approval (don't await - it waits for reaction)
    const approvalPromise = manager.requestApproval('Bash', { command: 'ls' }, context);

    // Wait for both reactions to be added (sendApprovalRequest fully completes)
    await vi.waitFor(() => {
      expect(mockClient.reactions.add).toHaveBeenCalledTimes(2);
    });

    // Verify message was posted to the right channel
    expect(mockClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'C123',
        text: expect.stringContaining('Permission Required'),
      }),
    );

    // Verify reactions were added
    expect(mockClient.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'white_check_mark' }),
    );
    expect(mockClient.reactions.add).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'x' }),
    );

    // Simulate user approving
    manager.handleApprovalReaction('C123', 'approval-ts-001', 'U456', true);

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should handle denial via reaction', async () => {
    const context: SlackContext = {
      channelId: 'C123',
      channelName: 'test',
      userId: 'U456',
    };

    const approvalPromise = manager.requestApproval('Write', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockClient.reactions.add).toHaveBeenCalledTimes(2);
    });

    manager.handleApprovalReaction('C123', 'approval-ts-001', 'U456', false);

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('deny');
    expect(decision.message).toContain('Denied by user');
  });

  it('should reject approval from unauthorized user', async () => {
    const context: SlackContext = {
      channelId: 'C123',
      channelName: 'test',
      userId: 'U456',
    };

    const approvalPromise = manager.requestApproval('Bash', { command: 'rm -rf /' }, context);

    await vi.waitFor(() => {
      expect(mockClient.reactions.add).toHaveBeenCalledTimes(2);
    });

    // Unauthorized user tries to approve
    manager.handleApprovalReaction('C123', 'approval-ts-001', 'U999', true);

    // Approve with correct user to finish the test
    manager.handleApprovalReaction('C123', 'approval-ts-001', 'U456', true);

    const decision = await approvalPromise;
    expect(decision.behavior).toBe('allow');
  });

  it('should fallback when no client is set', async () => {
    const managerNoClient = new SlackPermissionManager();

    // Safe tool should still be allowed via fallback
    const decision = await managerNoClient.requestApproval('Read', { file_path: '/test' });
    expect(decision.behavior).toBe('allow');

    managerNoClient.cleanup();
  });

  it('should delete message on approval/denial', async () => {
    const context: SlackContext = {
      channelId: 'C123',
      channelName: 'test',
      userId: 'U456',
    };

    const approvalPromise = manager.requestApproval('Edit', { file_path: '/test' }, context);

    await vi.waitFor(() => {
      expect(mockClient.reactions.add).toHaveBeenCalledTimes(2);
    });

    manager.handleApprovalReaction('C123', 'approval-ts-001', 'U456', true);
    await approvalPromise;

    // Wait for async delete
    await vi.waitFor(() => {
      expect(mockClient.chat.delete).toHaveBeenCalledWith(
        expect.objectContaining({ channel: 'C123', ts: 'approval-ts-001' }),
      );
    });
  });
});
