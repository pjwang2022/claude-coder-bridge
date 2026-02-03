import type { SlackContext } from './slack-context.js';
import type { PermissionDecision } from '../../shared/permissions.js';

export type { PermissionDecision } from '../../shared/permissions.js';

/**
 * Basic permission decision function (fallback)
 * Used when PermissionManager can't handle the request
 * (e.g., no Slack context, Slack bot unavailable)
 */
export async function approveToolRequest(
  toolName: string,
  input: any,
  slackContext?: SlackContext,
): Promise<PermissionDecision> {
  console.log('Slack basic permission request processing:', {
    toolName,
    input,
    slackContext,
  });

  try {
    const decision = await makePermissionDecision(toolName, input, slackContext);
    console.log('Slack basic permission decision made:', decision);
    return decision;
  } catch (error) {
    console.error('Error making Slack basic permission decision:', error);
    return {
      behavior: 'deny',
      message: `Permission check failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function makePermissionDecision(
  toolName: string,
  input: any,
  slackContext?: SlackContext,
): Promise<PermissionDecision> {
  console.log(`Processing Slack fallback permission for tool: ${toolName}`);

  if (slackContext) {
    const channelRules = getChannelPermissions(slackContext.channelName);

    if (channelRules.allowAll) {
      console.log(`Slack channel ${slackContext.channelName} allows all tools`);
      return { behavior: 'allow', updatedInput: input };
    }

    if (channelRules.denyDangerous && isDangerousTool(toolName)) {
      console.log(`Slack channel ${slackContext.channelName} denies dangerous tool: ${toolName}`);
      return {
        behavior: 'deny',
        message: `Dangerous tool ${toolName} not allowed in channel ${slackContext.channelName}`,
      };
    }
  }

  if (isSafeTool(toolName)) {
    return { behavior: 'allow', updatedInput: input };
  }

  if (isDangerousTool(toolName)) {
    return {
      behavior: 'deny',
      message: `Dangerous tool ${toolName} requires interactive approval which is not available`,
    };
  }

  return {
    behavior: 'deny',
    message: `Unknown tool ${toolName} denied for safety`,
  };
}

function isSafeTool(toolName: string): boolean {
  const safeTools = ['Read', 'Glob', 'Grep', 'LS', 'TodoRead', 'WebFetch', 'WebSearch'];
  return safeTools.includes(toolName);
}

function isDangerousTool(toolName: string): boolean {
  const dangerousTools = ['Bash', 'Write', 'Edit', 'MultiEdit', 'TodoWrite'];
  return dangerousTools.includes(toolName);
}

function getChannelPermissions(channelName?: string): {
  allowAll: boolean;
  denyDangerous: boolean;
  requireConfirmation: boolean;
} {
  if (!channelName) {
    return { allowAll: false, denyDangerous: true, requireConfirmation: true };
  }

  if (channelName === 'dev' || channelName === 'test' || channelName === 'sandbox' ||
      channelName.endsWith('-dev') || channelName.endsWith('-test') || channelName.endsWith('-sandbox')) {
    return { allowAll: true, denyDangerous: false, requireConfirmation: false };
  }

  if (channelName.includes('prod') || channelName.includes('main') || channelName.includes('live')) {
    return { allowAll: false, denyDangerous: true, requireConfirmation: true };
  }

  return { allowAll: false, denyDangerous: false, requireConfirmation: true };
}
