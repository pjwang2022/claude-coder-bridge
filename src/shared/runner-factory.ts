import type { ProcessCallbacks, ProcessHandle } from './process-runner.js';

export interface RunnerOptions {
  workingDir: string;
  prompt: string;
  sessionId?: string;
  timeoutMs?: number;
  model?: string;
  maxTokens?: number;
  platformContext?: {
    platform: 'discord' | 'line' | 'slack' | 'telegram' | 'email' | 'webui';
    channelId?: string;
    userId?: string;
    permissionManager?: any;
  };
}

/**
 * Check if API mode is enabled.
 * Returns true only if CLAUDE_MODE=api AND ANTHROPIC_API_KEY is set.
 */
export function isApiMode(): boolean {
  const mode = process.env.CLAUDE_MODE;
  if (mode !== 'api') return false;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('CLAUDE_MODE=api but ANTHROPIC_API_KEY is not set. Falling back to CLI mode.');
    return false;
  }

  return true;
}

/**
 * Create an API runner for the given options.
 * Only use this when isApiMode() returns true.
 */
export async function createApiRunner(
  options: RunnerOptions,
  callbacks: ProcessCallbacks
): Promise<ProcessHandle> {
  // Dynamic import to avoid loading API dependencies when not needed
  const { runApiProcess } = await import('../api/api-runner.js');
  return runApiProcess(options, callbacks);
}
