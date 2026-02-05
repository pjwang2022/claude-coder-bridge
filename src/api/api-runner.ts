import Anthropic from '@anthropic-ai/sdk';
import type { ProcessCallbacks, ProcessHandle } from '../shared/process-runner.js';
import type { ApiRunnerOptions, ToolResult, ContentBlock, ToolUseBlock, TextBlock } from './types.js';
import { ApiSessionManager } from './session-manager.js';
import { executeToolCallSafe } from './tool-executor.js';
import { getToolDefinitions } from './tools/index.js';
import { requiresApproval } from '../shared/permissions.js';

// Pricing per million tokens (as of 2024)
const PRICING = {
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-opus-4-20250514': { input: 15, output: 75 },
  'claude-3-5-sonnet-20241022': { input: 3, output: 15 },
  'claude-3-5-haiku-20241022': { input: 0.8, output: 4 },
} as const;

function calculateCost(
  model: string,
  usage: { input_tokens: number; output_tokens: number }
): number {
  const pricing = PRICING[model as keyof typeof PRICING] || PRICING['claude-sonnet-4-20250514'];
  const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
  const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

function extractTextContent(content: ContentBlock[]): string {
  return content
    .filter((c): c is TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
}

function buildSystemPrompt(workingDir: string): string {
  return `You are Claude, an AI assistant helping with software development tasks.

Current working directory: ${workingDir}

You have access to the following tools:
- Read: Read file contents
- Glob: Find files matching a pattern
- Grep: Search for text in files
- Bash: Execute shell commands
- Write: Write content to a file
- Edit: Edit a file by replacing specific text

Always use tools to interact with the filesystem. When editing files, make sure to use the exact text that appears in the file.

Be concise and helpful. Focus on completing the task efficiently.`;
}

/**
 * Run a conversation with Claude using the API directly.
 * Emits the same callbacks as spawnClaudeProcess for compatibility.
 */
export function runApiProcess(
  options: ApiRunnerOptions,
  callbacks: ProcessCallbacks
): ProcessHandle {
  let aborted = false;

  // Start async execution
  runConversationLoop(options, callbacks, () => aborted).catch((error) => {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  });

  return {
    kill: () => {
      aborted = true;
    },
    pid: undefined,
  };
}

async function runConversationLoop(
  options: ApiRunnerOptions,
  callbacks: ProcessCallbacks,
  isAborted: () => boolean
): Promise<void> {
  const client = new Anthropic();
  const model = options.model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';
  const maxTokens = options.maxTokens || parseInt(process.env.ANTHROPIC_MAX_TOKENS || '8192', 10);

  const sessionManager = new ApiSessionManager(options.sessionId);
  const sessionId = sessionManager.getSessionId();

  const startTime = Date.now();
  let numTurns = 0;
  let totalCost = 0;

  // Emit init event (matching CLI format)
  callbacks.onInit({
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    cwd: options.workingDir,
    model,
    tools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
    mcp_servers: [],
    apiKeySource: 'environment',
    permissionMode: 'default',
  });

  // Add the user's prompt
  sessionManager.addUserMessage(options.prompt);

  const toolDefinitions = getToolDefinitions().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));

  try {
    while (!isAborted()) {
      numTurns++;

      // Check timeout
      if (options.timeoutMs && Date.now() - startTime > options.timeoutMs) {
        callbacks.onTimeout();
        return;
      }

      // Make API request
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: buildSystemPrompt(options.workingDir),
        messages: sessionManager.getMessages(),
        tools: toolDefinitions,
      });

      // Calculate cost
      totalCost += calculateCost(model, response.usage);

      // Emit assistant message (matching CLI format)
      callbacks.onAssistantMessage({
        type: 'assistant',
        session_id: sessionId,
        message: {
          content: response.content.map((c) => {
            if (c.type === 'text') {
              return { type: 'text', text: c.text };
            } else if (c.type === 'tool_use') {
              return {
                type: 'tool_use',
                id: c.id,
                name: c.name,
                input: c.input,
              };
            }
            return c;
          }),
        },
      });

      sessionManager.addAssistantMessage(response.content);

      // Check for tool use
      const toolUses = response.content.filter(
        (c): c is ToolUseBlock => c.type === 'tool_use'
      );

      if (toolUses.length === 0 || response.stop_reason === 'end_turn') {
        // Conversation complete
        callbacks.onResult({
          type: 'result',
          subtype: 'success',
          session_id: sessionId,
          duration_ms: Date.now() - startTime,
          duration_api_ms: Date.now() - startTime,
          is_error: false,
          num_turns: numTurns,
          result: extractTextContent(response.content),
          total_cost_usd: totalCost,
        });
        return;
      }

      // Execute tools
      const toolResults: ToolResult[] = [];

      for (const toolUse of toolUses) {
        if (isAborted()) break;

        const result = await executeToolWithPermission(
          toolUse,
          options,
        );
        toolResults.push(result);
      }

      if (isAborted()) {
        callbacks.onError(new Error('Process was cancelled'));
        return;
      }

      // Emit tool results (matching CLI format)
      callbacks.onToolResult({
        type: 'user',
        session_id: sessionId,
        message: {
          content: toolResults.map((r) => ({
            type: 'tool_result',
            tool_use_id: r.tool_use_id,
            content: r.content,
            is_error: r.is_error,
          })),
        },
      });

      sessionManager.addToolResults(toolResults);

      // Safety: prevent infinite loops
      if (numTurns > 50) {
        callbacks.onResult({
          type: 'result',
          subtype: 'error_max_turns',
          session_id: sessionId,
          duration_ms: Date.now() - startTime,
          duration_api_ms: Date.now() - startTime,
          is_error: true,
          num_turns: numTurns,
          total_cost_usd: totalCost,
        });
        return;
      }
    }

    // Aborted
    callbacks.onError(new Error('Process was cancelled'));
  } catch (error) {
    callbacks.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function executeToolWithPermission(
  toolUse: ToolUseBlock,
  options: ApiRunnerOptions
): Promise<ToolResult> {
  const { name, input, id } = toolUse;

  // Check if tool requires permission
  if (requiresApproval(name, input)) {
    const permissionManager = options.platformContext?.permissionManager;
    const context = options.platformContext;

    if (permissionManager && context) {
      try {
        // Build the context object expected by permission managers
        const platformContext = {
          channelId: context.channelId,
          userId: context.userId,
        };

        const decision = await permissionManager.requestApproval(
          name,
          input,
          platformContext
        );

        if (decision.behavior === 'deny') {
          return {
            tool_use_id: id,
            content: `Permission denied: ${decision.message || 'User denied the request'}`,
            is_error: true,
          };
        }
      } catch (error) {
        // If permission request fails, deny by default for safety
        return {
          tool_use_id: id,
          content: `Permission request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          is_error: true,
        };
      }
    } else {
      // No permission manager available - deny dangerous tools
      return {
        tool_use_id: id,
        content: `Tool "${name}" requires approval but no permission manager is available`,
        is_error: true,
      };
    }
  }

  // Execute the tool
  return executeToolCallSafe(id, name, input, options.workingDir);
}
