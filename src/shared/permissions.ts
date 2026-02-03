export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: any;
  message?: string;
}

export function generateRequestId(): string {
  return `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Determine if a tool requires approval based on risk level.
 * Safe tools are auto-approved; dangerous/unknown tools need interactive approval.
 */
export function requiresApproval(toolName: string, input: any): boolean {
  const safeTools = [
    'Read',
    'Glob',
    'Grep',
    'LS',
    'TodoRead',
    'WebFetch',
    'WebSearch',
  ];

  const dangerousTools = [
    'Bash',
    'Write',
    'Edit',
    'MultiEdit',
    'TodoWrite',
  ];

  if (safeTools.includes(toolName)) {
    return false;
  }

  if (dangerousTools.includes(toolName)) {
    return true;
  }

  // Unknown tools require approval for safety
  return true;
}
