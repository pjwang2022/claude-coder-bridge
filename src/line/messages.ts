import type { LineTaskResult, TaskResultData } from './types.js';

// --- Flex Message Container Types ---

interface FlexBubble {
  type: 'bubble';
  header?: FlexBox;
  body?: FlexBox;
  footer?: FlexBox;
}

interface FlexBox {
  type: 'box';
  layout: 'vertical' | 'horizontal' | 'baseline';
  contents: any[];
  spacing?: string;
  paddingAll?: string;
  backgroundColor?: string;
}

// --- Result Message ---

export function buildResultFlexMessage(task: LineTaskResult): object {
  const isSuccess = task.status === 'completed';
  const headerColor = isSuccess ? '#27ae60' : '#e74c3c';
  const statusText = isSuccess ? 'Complete' : 'Failed';

  let resultData: TaskResultData | null = null;
  try {
    if (task.result) resultData = JSON.parse(task.result);
  } catch {
    // ignore parse errors
  }

  const bodyContents: any[] = [];

  // Final result text
  const resultText = resultData?.finalResult || resultData?.error || 'No result data';
  bodyContents.push({
    type: 'text',
    text: truncate(resultText, 1500),
    wrap: true,
    size: 'sm',
    color: '#333333',
  });

  // Tool calls summary
  const toolCalls = resultData?.toolCalls || [];
  if (toolCalls.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push({
      type: 'text',
      text: 'Actions',
      size: 'xs',
      weight: 'bold',
      color: '#999999',
      margin: 'md',
    });

    // Show up to 10 tool calls
    const displayCalls = toolCalls.slice(0, 10);
    for (const call of displayCalls) {
      const inputSummary = summarizeInput(call.input);
      bodyContents.push({
        type: 'text',
        text: `${getToolEmoji(call.name)} ${call.name} ${inputSummary}`,
        size: 'xs',
        color: '#666666',
        wrap: true,
      });
    }
    if (toolCalls.length > 10) {
      bodyContents.push({
        type: 'text',
        text: `... and ${toolCalls.length - 10} more`,
        size: 'xs',
        color: '#999999',
      });
    }
  }

  // Metadata
  const metaParts: string[] = [];
  if (resultData?.numTurns) metaParts.push(`${resultData.numTurns} turns`);
  if (resultData?.costUsd) metaParts.push(`$${resultData.costUsd.toFixed(4)}`);
  if (metaParts.length > 0) {
    bodyContents.push({ type: 'separator', margin: 'md' });
    bodyContents.push({
      type: 'text',
      text: metaParts.join(' · '),
      size: 'xxs',
      color: '#aaaaaa',
      margin: 'sm',
    });
  }

  return {
    type: 'flex',
    altText: `${statusText}: ${truncate(task.prompt, 50)}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'text',
            text: `${isSuccess ? '✅' : '❌'} ${statusText}`,
            size: 'md',
            weight: 'bold',
            color: '#ffffff',
            flex: 1,
          },
          {
            type: 'text',
            text: task.projectName,
            size: 'xs',
            color: '#ffffffcc',
            align: 'end',
          },
        ],
        backgroundColor: headerColor,
        paddingAll: '12px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: bodyContents,
        paddingAll: '12px',
        spacing: 'sm',
      },
    } satisfies FlexBubble,
  };
}

// --- Approval Message ---

export function buildApprovalFlexMessage(
  requestId: string,
  toolName: string,
  input: any
): object {
  const inputStr = JSON.stringify(input, null, 2);
  const truncatedInput = truncate(inputStr, 500);

  return {
    type: 'flex',
    altText: `Permission required: ${toolName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '🔐 Permission Required', size: 'md', weight: 'bold', color: '#ffffff' },
        ],
        backgroundColor: '#f39c12',
        paddingAll: '12px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: `Tool: ${toolName}`, weight: 'bold', size: 'sm' },
          { type: 'text', text: truncatedInput, size: 'xs', color: '#666666', wrap: true, margin: 'sm' },
        ],
        paddingAll: '12px',
        spacing: 'sm',
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        contents: [
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'Approve',
              data: `action=approve&requestId=${requestId}`,
              displayText: `Approved: ${toolName}`,
            },
            style: 'primary',
            color: '#27ae60',
            height: 'sm',
          },
          {
            type: 'button',
            action: {
              type: 'postback',
              label: 'Deny',
              data: `action=deny&requestId=${requestId}`,
              displayText: `Denied: ${toolName}`,
            },
            style: 'secondary',
            height: 'sm',
            margin: 'sm',
          },
        ],
        paddingAll: '12px',
        spacing: 'sm',
      },
    } satisfies FlexBubble,
  };
}

// --- Project List ---

export function buildProjectListFlexMessage(
  projects: string[],
  currentProject?: string
): object {
  const items = projects.slice(0, 20).map(name => ({
    type: 'text' as const,
    text: `${name === currentProject ? '▶ ' : '  '}${name}`,
    size: 'sm' as const,
    color: name === currentProject ? '#27ae60' : '#333333',
  }));

  if (projects.length === 0) {
    items.push({ type: 'text', text: 'No projects found.', size: 'sm', color: '#999999' });
  }

  return {
    type: 'flex',
    altText: 'Project List',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        contents: [
          { type: 'text', text: '📂 Projects', size: 'md', weight: 'bold', color: '#ffffff' },
        ],
        backgroundColor: '#3498db',
        paddingAll: '12px',
      },
      body: {
        type: 'box',
        layout: 'vertical',
        contents: [
          ...items,
          ...(currentProject
            ? [{ type: 'separator', margin: 'md' }, {
                type: 'text',
                text: `Current: ${currentProject}`,
                size: 'xs',
                color: '#999999',
                margin: 'sm',
              }]
            : []),
        ],
        paddingAll: '12px',
        spacing: 'xs',
      },
    } satisfies FlexBubble,
  };
}

// --- Simple Text Messages ---

export function buildProcessingReply(hasQuota: boolean): { type: 'text'; text: string } {
  const base = '⏳ Processing...';
  if (!hasQuota) {
    return { type: 'text', text: `${base}\nPush quota exhausted. Use /result to check the outcome.` };
  }
  return { type: 'text', text: base };
}

export function buildStatusReply(runningTasks: LineTaskResult[]): { type: 'text'; text: string } {
  if (runningTasks.length === 0) {
    return { type: 'text', text: 'No tasks currently running.' };
  }
  const lines = runningTasks.map(t => {
    const elapsed = Math.round((Date.now() - t.createdAt) / 1000);
    return `▶ ${t.projectName}: "${truncate(t.prompt, 40)}" (${elapsed}s)`;
  });
  return { type: 'text', text: `Running tasks:\n${lines.join('\n')}` };
}

export function buildErrorReply(error: string): { type: 'text'; text: string } {
  return { type: 'text', text: `Error: ${error}` };
}

export function buildHelpReply(): { type: 'text'; text: string } {
  return {
    type: 'text',
    text: [
      'Commands:',
      '/project <name> - Set current project',
      '/project list - List available projects',
      '/result - Get latest task result',
      '/status - Check running tasks',
      '/clear - Clear session for current project',
      '/help - Show this message',
      '',
      'Or just send a message to run Claude Code.',
    ].join('\n'),
  };
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
