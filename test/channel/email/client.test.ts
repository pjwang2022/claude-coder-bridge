import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('imapflow', () => ({
  ImapFlow: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    idle: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockReturnValue([]),
    messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    usable: true,
  })),
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({
      sendMail: vi.fn().mockResolvedValue({ messageId: '<reply@test>' }),
      close: vi.fn(),
    }),
  },
}));

vi.mock('mailparser', () => ({
  simpleParser: vi.fn().mockResolvedValue({
    from: { value: [{ address: 'user@test.com' }] },
    subject: '[test] hello',
    messageId: '<msg@test>',
    text: 'hello world',
    attachments: [],
  }),
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn(),
}));

vi.mock('../../../src/db/database.js', () => ({
  DatabaseManager: vi.fn().mockImplementation(() => ({
    getLatestEmailTask: vi.fn(),
    getRunningEmailTasks: vi.fn().mockReturnValue([]),
    getSession: vi.fn(),
    setSession: vi.fn(),
    clearSession: vi.fn(),
    cleanupOldEmailTasks: vi.fn(),
    close: vi.fn(),
  })),
}));

import { EmailBot } from '../../../src/channel/email/client.js';
import type { EmailConfig } from '../../../src/channel/email/types.js';

describe('EmailBot', () => {
  let bot: EmailBot;
  const config: EmailConfig = {
    imapHost: 'imap.test.com',
    imapPort: 993,
    smtpHost: 'smtp.test.com',
    smtpPort: 587,
    emailUser: 'bot@test.com',
    emailPass: 'pass123',
    allowedSenders: ['user@test.com'],
  };

  const mockClaudeManager = {
    hasActiveProcess: vi.fn().mockReturnValue(false),
    clearSession: vi.fn(),
    setTransporter: vi.fn(),
    setBotEmail: vi.fn(),
    runTask: vi.fn().mockResolvedValue(1),
    destroy: vi.fn(),
  };

  const mockPermissionManager = {
    setTransporter: vi.fn(),
    setBotEmail: vi.fn(),
    handleApprovalHttp: vi.fn(),
    requestApproval: vi.fn(),
    cleanup: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    bot = new EmailBot(config, mockClaudeManager as any, mockPermissionManager as any, '/test/base');
  });

  describe('constructor', () => {
    it('should create instance without throwing', () => {
      expect(() => new EmailBot(config, mockClaudeManager as any, mockPermissionManager as any, '/test/base')).not.toThrow();
    });

    it('should expose transporter for external use', () => {
      expect(bot.transporter).toBeDefined();
      expect(bot.transporter.sendMail).toBeDefined();
    });
  });

  describe('start', () => {
    it('should connect to IMAP', async () => {
      // start() calls connect then launches listenLoop, which will hang on idle.
      // We avoid that by making idle reject to break the loop.
      const imapInstance = (bot as any).imap;
      imapInstance.idle.mockRejectedValueOnce(new Error('stopped'));
      (bot as any).running = false; // ensure loop exits

      await bot.start();
      expect(imapInstance.connect).toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should logout from IMAP and close transporter', async () => {
      const imapInstance = (bot as any).imap;
      await bot.stop();
      expect(imapInstance.logout).toHaveBeenCalled();
      expect(bot.transporter.close).toHaveBeenCalled();
    });
  });

  describe('sendReply', () => {
    it('should send email with In-Reply-To header', async () => {
      await (bot as any).sendReply('user@test.com', '<orig@test>', {
        subject: 'Test',
        text: 'Hello',
      });

      expect(bot.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: 'bot@test.com',
          to: 'user@test.com',
          subject: 'Test',
          text: 'Hello',
          inReplyTo: '<orig@test>',
          references: '<orig@test>',
        }),
      );
    });
  });
});
