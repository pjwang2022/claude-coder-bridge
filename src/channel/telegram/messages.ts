import type { TelegramTaskResult, TaskResultData } from './types.js';

// --- Result Message ---

export function buildResultMessage(task: TelegramTaskResult): { text: string; parseMode: 'MarkdownV2' } {
  const isSuccess = task.status === 'completed';
  const statusEmoji = isSuccess ? '✅' : '❌';
  const statusText = isSuccess ? 'Complete' : 'Failed';

  let resultData: TaskResultData | null = null;
  try {
    if (task.result) resultData = JSON.parse(task.result);
  } catch {
    // ignore parse errors
  }

  const parts: string[] = [];

  // Header
  parts.push(`${statusEmoji} *${escMd(statusText)}* \\| _${escMd(task.projectName)}_`);
  parts.push('');

  // Result text
  const resultText = resultData?.finalResult || resultData?.error || 'No result data';
  const displayText = resultText.length > 2900 ? truncate(resultText, 2900) + '\n\n---\n⚠ Response truncated. Full result available in project folder.' : resultText;
  parts.push(escMd(displayText));

  // Tool calls summary
  const toolCalls = resultData?.toolCalls || [];
  if (toolCalls.length > 0) {
    parts.push('');
    parts.push(`*Actions* \\(${toolCalls.length}\\)`);
    const displayCalls = toolCalls.slice(0, 10);
    for (const call of displayCalls) {
      const inputSummary = summarizeInput(call.input);
      parts.push(`${escMd(getToolEmoji(call.name))} \`${escMd(call.name)}\` ${escMd(inputSummary)}`);
    }
    if (toolCalls.length > 10) {
      parts.push(escMd(`... and ${toolCalls.length - 10} more`));
    }
  }

  // Metadata
  const metaParts: string[] = [];
  if (resultData?.numTurns) metaParts.push(`${resultData.numTurns} turns`);
  if (resultData?.costUsd) metaParts.push(`$${resultData.costUsd.toFixed(4)}`);
  if (metaParts.length > 0) {
    parts.push('');
    parts.push(`_${escMd(metaParts.join(' · '))}_`);
  }

  return { text: parts.join('\n'), parseMode: 'MarkdownV2' };
}

// --- Approval Message ---

export function buildApprovalMessage(
  requestId: string,
  toolName: string,
  input: any,
): { text: string; parseMode: 'MarkdownV2'; inlineKeyboard: Array<Array<{ text: string; callback_data: string }>> } {
  const inputStr = JSON.stringify(input, null, 2);
  const truncatedInput = inputStr.length > 1500
    ? truncate(inputStr, 1500) + '\n(parameters truncated, review carefully)'
    : inputStr;

  const text = [
    '🔐 *Permission Required*',
    '',
    `*Tool:* \`${escMd(toolName)}\``,
    `\`\`\``,
    `${escMd(truncatedInput)}`,
    `\`\`\``,
  ].join('\n');

  return {
    text,
    parseMode: 'MarkdownV2',
    inlineKeyboard: [
      [
        { text: '✅ Approve', callback_data: `action=approve&requestId=${requestId}` },
        { text: '❌ Deny', callback_data: `action=deny&requestId=${requestId}` },
      ],
    ],
  };
}

// --- Project List ---

export function buildProjectListMessage(
  projects: string[],
  currentProject?: string,
): { text: string; parseMode: 'MarkdownV2' } {
  const parts: string[] = [];
  parts.push('📂 *Projects*');
  parts.push('');

  if (projects.length === 0) {
    parts.push(escMd('No projects found.'));
  } else {
    for (const name of projects.slice(0, 20)) {
      const marker = name === currentProject ? '▶ ' : '  ';
      parts.push(escMd(`${marker}${name}`));
    }
  }

  if (currentProject) {
    parts.push('');
    parts.push(`_Current: ${escMd(currentProject)}_`);
  }

  return { text: parts.join('\n'), parseMode: 'MarkdownV2' };
}

// --- Simple Text Messages ---

export function buildProcessingMessage(): string {
  return '⏳ Processing... Use /result to check the outcome.';
}

export function buildStatusMessage(runningTasks: TelegramTaskResult[]): string {
  if (runningTasks.length === 0) {
    return 'No tasks currently running.';
  }
  const lines = runningTasks.map(t => {
    const elapsed = Math.round((Date.now() - t.createdAt) / 1000);
    return `▶ ${t.projectName}: "${truncate(t.prompt, 40)}" (${elapsed}s)`;
  });
  return `Running tasks:\n${lines.join('\n')}`;
}

export function buildHelpMessage(): string {
  return [
    'Commands:',
    '/project <name> - Set current project',
    '/project - List available projects',
    '/result - Get latest task result',
    '/status - Check running tasks',
    '/cancel - Cancel the current running task',
    '/clear - Clear session for current project',
    '/help - Show this message',
    '',
    'Or just send a message to run Claude Code.',
  ].join('\n');
}

// --- Helpers ---

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
}

function summarizeInput(input: any): string {
  if (!input || typeof input !== 'object') return '';
  const entries = Object.entries(input);
  if (entries.length === 0) return '';
  const parts = entries.slice(0, 2).map(([k, v]) => {
    const val = truncate(String(v), 40);
    return `${k}=${val}`;
  });
  return `(${parts.join(', ')})`;
}

function getToolEmoji(toolName: string): string {
  const map: Record<string, string> = {
    Read: '📄', Glob: '🔍', Grep: '🔎', Bash: '▶',
    Write: '✏️', Edit: '✏️', MultiEdit: '✏️',
    LS: '📁', WebFetch: '🌐', WebSearch: '🌐',
  };
  return map[toolName] || '🔧';
}

// Escape special MarkdownV2 characters
function escMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}
