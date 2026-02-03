import type { EmailTaskResult, TaskResultData } from './types.js';

// --- Result Email ---

export function buildResultEmail(task: EmailTaskResult): { subject: string; html: string } {
  const isSuccess = task.status === 'completed';
  const statusEmoji = isSuccess ? '✅' : '❌';
  const statusText = isSuccess ? 'Complete' : 'Failed';
  const headerColor = isSuccess ? '#27ae60' : '#e74c3c';

  let resultData: TaskResultData | null = null;
  try {
    if (task.result) resultData = JSON.parse(task.result);
  } catch {
    // ignore
  }

  const resultText = resultData?.finalResult || resultData?.error || 'No result data';
  const toolCalls = resultData?.toolCalls || [];

  let toolCallsHtml = '';
  if (toolCalls.length > 0) {
    const displayCalls = toolCalls.slice(0, 15);
    const callLines = displayCalls.map(call => {
      const inputSummary = summarizeInput(call.input);
      return `<li><code>${esc(call.name)}</code> ${esc(inputSummary)}</li>`;
    }).join('\n');
    const moreText = toolCalls.length > 15 ? `<li>... and ${toolCalls.length - 15} more</li>` : '';
    toolCallsHtml = `
      <h3 style="color:#666;margin-top:16px;">Actions (${toolCalls.length})</h3>
      <ul style="font-size:13px;color:#555;">${callLines}${moreText}</ul>
    `;
  }

  const metaParts: string[] = [];
  if (resultData?.numTurns) metaParts.push(`${resultData.numTurns} turns`);
  if (resultData?.costUsd) metaParts.push(`$${resultData.costUsd.toFixed(4)}`);
  const metaHtml = metaParts.length > 0
    ? `<p style="color:#999;font-size:12px;margin-top:12px;">${esc(metaParts.join(' · '))}</p>`
    : '';

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:700px;">
      <div style="background:${headerColor};color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;">
        <strong>${statusEmoji} ${statusText}</strong> — ${esc(task.projectName)}
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:16px;border-radius:0 0 8px 8px;">
        <pre style="white-space:pre-wrap;word-wrap:break-word;background:#f6f8fa;padding:12px;border-radius:6px;font-size:13px;overflow:auto;">${esc(resultText.length > 5000 ? truncate(resultText, 5000) + '\n\n---\n⚠ Response truncated. Full result available in project folder.' : resultText)}</pre>
        ${toolCallsHtml}
        ${metaHtml}
      </div>
    </div>
  `;

  return {
    subject: `${statusEmoji} ${statusText}: ${truncate(task.prompt, 60)}`,
    html,
  };
}

// --- Approval Email ---

export function buildApprovalEmail(
  requestId: string,
  token: string,
  toolName: string,
  input: any,
  baseUrl: string,
): { subject: string; html: string } {
  const inputStr = JSON.stringify(input, null, 2);
  const truncatedInput = inputStr.length > 2000
    ? truncate(inputStr, 2000) + '\n(parameters truncated, review carefully)'
    : inputStr;

  const approveUrl = `${baseUrl}/email/approve?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(token)}`;
  const denyUrl = `${baseUrl}/email/deny?requestId=${encodeURIComponent(requestId)}&token=${encodeURIComponent(token)}`;

  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:700px;">
      <div style="background:#f39c12;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;">
        <strong>🔐 Permission Required</strong>
      </div>
      <div style="border:1px solid #eee;border-top:none;padding:16px;border-radius:0 0 8px 8px;">
        <p><strong>Tool:</strong> <code>${esc(toolName)}</code></p>
        <pre style="white-space:pre-wrap;word-wrap:break-word;background:#f6f8fa;padding:12px;border-radius:6px;font-size:12px;overflow:auto;">${esc(truncatedInput)}</pre>
        <div style="margin-top:16px;">
          <a href="${approveUrl}" style="display:inline-block;padding:10px 24px;background:#27ae60;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;margin-right:8px;">✅ Approve</a>
          <a href="${denyUrl}" style="display:inline-block;padding:10px 24px;background:#e74c3c;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;">❌ Deny</a>
        </div>
      </div>
    </div>
  `;

  return {
    subject: `🔐 Permission Required: ${toolName}`,
    html,
  };
}

// --- Simple Messages ---

export function buildProcessingEmail(): { subject: string; text: string } {
  return {
    subject: '⏳ Processing your request',
    text: 'Your request is being processed by Claude Code. You will receive the result in a follow-up email.',
  };
}

export function buildErrorEmail(error: string): { subject: string; text: string } {
  return {
    subject: '❌ Error',
    text: `Error: ${error}`,
  };
}

export function buildStatusEmail(runningTasks: EmailTaskResult[]): { subject: string; text: string } {
  if (runningTasks.length === 0) {
    return { subject: 'Status', text: 'No tasks currently running.' };
  }
  const lines = runningTasks.map(t => {
    const elapsed = Math.round((Date.now() - t.createdAt) / 1000);
    return `▶ ${t.projectName}: "${truncate(t.prompt, 40)}" (${elapsed}s)`;
  });
  return { subject: 'Running tasks', text: `Running tasks:\n${lines.join('\n')}` };
}

export function buildHelpEmail(): { subject: string; text: string } {
  return {
    subject: 'Claude Code Email Bot — Help',
    text: [
      'Usage:',
      '',
      'Subject format: [project-name] your prompt here',
      'Example: [my-app] Fix the login bug',
      '',
      'Commands (in email body):',
      '  /result - Get latest task result',
      '  /status - Check running tasks',
      '  /clear  - Clear session for the project in subject',
      '  /help   - Show this message',
      '',
      'Tips:',
      '  - Reply to an existing thread to continue the conversation',
      '  - Attach images and they will be passed to Claude',
      '  - The project name in [brackets] must match a folder in the base directory',
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

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
