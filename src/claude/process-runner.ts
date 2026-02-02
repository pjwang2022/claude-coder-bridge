import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { SDKMessage } from '../types/index.js';

export interface ProcessCallbacks {
  onInit: (parsed: SDKMessage & { type: 'system' }) => void;
  onAssistantMessage: (parsed: SDKMessage & { type: 'assistant' }) => void;
  onToolResult: (parsed: any) => void;
  onResult: (parsed: SDKMessage & { type: 'result' }) => void;
  onError: (error: Error) => void;
  onStderr: (text: string) => void;
  onTimeout: () => void;
  onClose?: (code: number | null) => void;
}

export interface ProcessHandle {
  kill: () => void;
  pid: number | undefined;
}

export function spawnClaudeProcess(
  commandString: string,
  callbacks: ProcessCallbacks,
  timeoutMs: number = 5 * 60 * 1000,
  logFile?: string
): ProcessHandle {
  const claude = spawn('/bin/bash', ['-c', commandString], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SHELL: '/bin/bash' },
  });

  console.log(`Process spawned with PID: ${claude.pid}`);

  claude.stdin.end();

  let buffer = '';

  const timeout = setTimeout(() => {
    console.log('Process timed out, killing');
    callbacks.onTimeout();
    claude.kill('SIGTERM');
  }, timeoutMs);

  claude.stdout.on('data', (data) => {
    const rawData = data.toString();

    if (logFile) {
      try {
        fs.appendFileSync(logFile,
          `[${new Date().toISOString()}]\n${rawData}\n---\n`);
      } catch {
        // ignore log write errors
      }
    }

    buffer += rawData;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed: SDKMessage = JSON.parse(line);

        if (parsed.type === 'assistant' && parsed.message.content) {
          callbacks.onAssistantMessage(parsed as any);
        } else if (parsed.type === 'user' && parsed.message.content) {
          callbacks.onToolResult(parsed);
        } else if (parsed.type === 'result') {
          callbacks.onResult(parsed as any);
          clearTimeout(timeout);
        } else if (parsed.type === 'system') {
          if ((parsed as any).subtype === 'init') {
            callbacks.onInit(parsed as any);
          }
        }
      } catch {
        // Skip unparseable lines
      }
    }
  });

  claude.stderr.on('data', (data) => {
    const text = data.toString();
    if (text.trim() && !text.includes('INFO') && !text.includes('DEBUG')) {
      callbacks.onStderr(text.trim());
    }
  });

  claude.on('error', (error) => {
    console.error('Process error:', error);
    clearTimeout(timeout);
    callbacks.onError(error);
  });

  claude.on('close', (code) => {
    console.log(`Process exited with code ${code}`);
    clearTimeout(timeout);
    callbacks.onClose?.(code);
    if (code !== 0 && code !== null) {
      callbacks.onError(new Error(`Process exited with code: ${code}`));
    }
  });

  return {
    kill: () => claude.kill('SIGTERM'),
    pid: claude.pid,
  };
}
