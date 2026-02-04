export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: any;
  message?: string;
}

export function generateRequestId(): string {
  return `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Parse AUTO_APPROVE_TOOLS env var into a set of tool names.
 * Supports comma-separated values, e.g. "Edit,Write,Bash"
 */
function getAutoApproveTools(): Set<string> {
  const raw = process.env.AUTO_APPROVE_TOOLS;
  if (!raw) return new Set();
  return new Set(raw.split(',').map(t => t.trim()).filter(Boolean));
}

/**
 * Determine if a tool requires approval based on risk level.
 * Safe tools are auto-approved; dangerous/unknown tools need interactive approval.
 * Tools listed in AUTO_APPROVE_TOOLS env var are also auto-approved.
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

  const autoApprove = getAutoApproveTools();
  if (autoApprove.has(toolName)) {
    return false;
  }

  if (dangerousTools.includes(toolName)) {
    return true;
  }

  // Unknown tools require approval for safety
  return true;
}
