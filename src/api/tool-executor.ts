import { tools, isValidTool, type ToolName } from './tools/index.js';
import type { ToolResult } from './types.js';

/**
 * Execute a tool call and return the result.
 */
export async function executeToolCall(
  toolName: string,
  input: any,
  workingDir: string
): Promise<string> {
  if (!isValidTool(toolName)) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const tool = tools[toolName as ToolName];
  return tool.execute(input, workingDir);
}

/**
 * Execute a tool call with proper error handling, returning a ToolResult.
 */
export async function executeToolCallSafe(
  toolUseId: string,
  toolName: string,
  input: any,
  workingDir: string
): Promise<ToolResult> {
  try {
    const result = await executeToolCall(toolName, input, workingDir);
    return {
      tool_use_id: toolUseId,
      content: result,
      is_error: false,
    };
  } catch (error) {
    return {
      tool_use_id: toolUseId,
      content: `Error: ${error instanceof Error ? error.message : String(error)}`,
      is_error: true,
    };
  }
}

/**
 * Format tool input for display (e.g., in approval messages).
 */
export function formatToolInput(toolName: string, input: any): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '';

  return entries
    .map(([key, value]) => {
      let val = String(value);
      // Truncate long values
      if (val.length > 100) {
        val = val.substring(0, 100) + '...';
      }
      return `${key}: ${val}`;
    })
    .join('\n');
}
