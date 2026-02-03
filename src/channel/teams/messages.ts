import type { TeamsTaskResult, TaskResultData } from './types.js';

export function buildApprovalCard(requestId: string, toolName: string, input: any): any {
  const inputStr = typeof input === 'object'
    ? JSON.stringify(input, null, 2)
    : String(input);

  const truncated = inputStr.length > 1500
    ? inputStr.substring(0, 1500) + '\n... (parameters truncated, review carefully)'
    : inputStr;

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: 'Tool Approval Required',
        weight: 'Bolder',
        size: 'Medium',
      },
      {
        type: 'FactSet',
        facts: [
          { title: 'Tool', value: toolName },
        ],
      },
      {
        type: 'TextBlock',
        text: '```\n' + truncated + '\n```',
        wrap: true,
        fontType: 'Monospace',
        size: 'Small',
      },
    ],
    actions: [
      {
        type: 'Action.Submit',
        title: 'Approve',
        style: 'positive',
        data: { action: 'approve', requestId },
      },
      {
        type: 'Action.Submit',
        title: 'Deny',
        style: 'destructive',
        data: { action: 'deny', requestId },
      },
    ],
  };
}

export function buildResultCard(task: TeamsTaskResult): any {
  let resultData: TaskResultData | null = null;
  try {
    if (task.result) {
      resultData = JSON.parse(task.result);
    }
  } catch { /* ignore */ }

  const statusEmoji = task.status === 'completed' ? '\u2705' : '\u274C';
  const facts: Array<{ title: string; value: string }> = [
    { title: 'Status', value: `${statusEmoji} ${task.status}` },
    { title: 'Project', value: task.projectName },
  ];

  if (resultData?.numTurns) {
    facts.push({ title: 'Turns', value: String(resultData.numTurns) });
  }
  if (resultData?.costUsd) {
    facts.push({ title: 'Cost', value: `$${resultData.costUsd.toFixed(4)}` });
  }

  const bodyBlocks: any[] = [
    {
      type: 'TextBlock',
      text: `Task Result (#${task.id})`,
      weight: 'Bolder',
      size: 'Medium',
    },
    {
      type: 'FactSet',
      facts,
    },
  ];

  const resultText = resultData?.finalResult || resultData?.error || 'No result';
  const truncatedResult = resultText.length > 900
    ? resultText.substring(0, 900) + '\n\n---\n⚠ Response truncated. Full result available in project folder.'
    : resultText;

  bodyBlocks.push({
    type: 'TextBlock',
    text: truncatedResult,
    wrap: true,
    size: 'Small',
  });

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: bodyBlocks,
  };
}

export function buildProjectListCard(projects: string[], currentProject?: string): any {
  const items = projects.map((p) => ({
    type: 'TextBlock',
    text: `${p === currentProject ? '\u25B6 ' : '  '}${p}`,
    spacing: 'Small',
    fontType: p === currentProject ? 'Default' : 'Monospace',
    weight: p === currentProject ? 'Bolder' : 'Default',
  }));

  return {
    type: 'AdaptiveCard',
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
    version: '1.4',
    body: [
      {
        type: 'TextBlock',
        text: 'Available Projects',
        weight: 'Bolder',
        size: 'Medium',
      },
      ...items,
      {
        type: 'TextBlock',
        text: currentProject
          ? `Current: **${currentProject}**`
          : 'Use `/project <name>` to select a project.',
        wrap: true,
        spacing: 'Medium',
      },
    ],
  };
}

export function buildHelpMessage(): string {
  return [
    '**Claude Code Teams Bot**',
    '',
    '**Commands:**',
    '- `/project` - List available projects',
    '- `/project <name>` - Select a project',
    '- `/result` - Get latest task result',
    '- `/status` - Check running tasks',
    '- `/clear` - Clear session for current project',
    '- `/help` - Show this help',
    '',
    'Send any other message to run Claude Code.',
  ].join('\n');
}

export function buildStatusMessage(running: TeamsTaskResult[]): string {
  if (running.length === 0) {
    return 'No running tasks.';
  }

  return running.map((t) => {
    const elapsed = Math.round((Date.now() - t.createdAt) / 1000);
    return `- Task #${t.id}: "${t.prompt.substring(0, 50)}..." (${elapsed}s) in ${t.projectName}`;
  }).join('\n');
}
