import { spawn } from 'child_process';

export interface BashInput {
  command: string;
  timeout?: number;
}

/**
 * Execute a bash command.
 * This is a dangerous tool that requires permission approval.
 */
export async function executeBash(input: BashInput, cwd: string): Promise<string> {
  const timeout = input.timeout || 120000; // 2 minutes default

  return new Promise((resolve, reject) => {
    const proc = spawn('/bin/bash', ['-c', input.command], {
      cwd,
      env: { ...process.env, SHELL: '/bin/bash' },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      proc.kill('SIGTERM');
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, 5000);
    }, timeout);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      // Truncate if too long
      if (stdout.length > 30000) {
        stdout = stdout.substring(0, 30000) + '\n... (output truncated)';
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      if (stderr.length > 10000) {
        stderr = stderr.substring(0, 10000) + '\n... (stderr truncated)';
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);

      if (killed) {
        resolve(`Command timed out after ${timeout / 1000} seconds.\nPartial output:\n${stdout}\n${stderr}`);
        return;
      }

      if (code === 0) {
        resolve(stdout || '(command completed with no output)');
      } else {
        const output = [];
        if (stdout) output.push(`stdout:\n${stdout}`);
        if (stderr) output.push(`stderr:\n${stderr}`);
        output.push(`Exit code: ${code}`);
        resolve(output.join('\n\n'));
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export const bashToolDefinition = {
  name: 'Bash',
  description: 'Execute a bash command. Use for running terminal commands, git operations, npm commands, etc.',
  input_schema: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string',
        description: 'The bash command to execute',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in milliseconds. Default is 120000 (2 minutes).',
      },
    },
    required: ['command'],
  },
};
