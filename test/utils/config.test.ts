import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { validateConfig } from '../../src/utils/config.js';

describe('validateConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should return config with discord when all Discord variables are set', () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.ALLOWED_USER_IDS = 'test-user-id';
    process.env.BASE_FOLDER = '/test/folder';

    const config = validateConfig();

    expect(config).toEqual({
      baseFolder: '/test/folder',
      discord: {
        token: 'test-token',
        allowedUserIds: ['test-user-id'],
      },
    });
  });

  it('should support comma-separated ALLOWED_USER_IDS', () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.ALLOWED_USER_IDS = 'user-1, user-2, user-3';
    process.env.BASE_FOLDER = '/test/folder';

    const config = validateConfig();

    expect(config).toEqual({
      baseFolder: '/test/folder',
      discord: {
        token: 'test-token',
        allowedUserIds: ['user-1', 'user-2', 'user-3'],
      },
    });
  });

  it('should return config without discord when DISCORD_TOKEN is missing', () => {
    delete process.env.DISCORD_TOKEN;
    process.env.ALLOWED_USER_IDS = 'test-user-id';
    process.env.BASE_FOLDER = '/test/folder';

    const config = validateConfig();

    expect(config).toEqual({
      baseFolder: '/test/folder',
      discord: undefined,
    });
  });

  it('should return config without discord when ALLOWED_USER_IDS is missing', () => {
    process.env.DISCORD_TOKEN = 'test-token';
    delete process.env.ALLOWED_USER_IDS;
    process.env.BASE_FOLDER = '/test/folder';

    const config = validateConfig();

    expect(config).toEqual({
      baseFolder: '/test/folder',
      discord: undefined,
    });
  });

  it('should exit with error when BASE_FOLDER is missing', () => {
    process.env.DISCORD_TOKEN = 'test-token';
    process.env.ALLOWED_USER_IDS = 'test-user-id';
    delete process.env.BASE_FOLDER;

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => validateConfig()).toThrow('process.exit called');
    expect(consoleSpy).toHaveBeenCalledWith('BASE_FOLDER environment variable is required');
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
    consoleSpy.mockRestore();
  });
});
