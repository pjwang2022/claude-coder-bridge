import { executeRead, readToolDefinition } from './read.js';
import { executeGlob, globToolDefinition } from './glob.js';
import { executeGrep, grepToolDefinition } from './grep.js';
import { executeBash, bashToolDefinition } from './bash.js';
import { executeWrite, writeToolDefinition } from './write.js';
import { executeEdit, editToolDefinition } from './edit.js';
import type { ToolDefinition } from '../types.js';

export type ToolName = 'Read' | 'Glob' | 'Grep' | 'Bash' | 'Write' | 'Edit';

export interface ToolHandler {
  execute: (input: any, cwd: string) => Promise<string>;
  definition: ToolDefinition;
}

export const tools: Record<ToolName, ToolHandler> = {
  Read: {
    execute: executeRead,
    definition: readToolDefinition,
  },
  Glob: {
    execute: executeGlob,
    definition: globToolDefinition,
  },
  Grep: {
    execute: executeGrep,
    definition: grepToolDefinition,
  },
  Bash: {
    execute: executeBash,
    definition: bashToolDefinition,
  },
  Write: {
    execute: executeWrite,
    definition: writeToolDefinition,
  },
  Edit: {
    execute: executeEdit,
    definition: editToolDefinition,
  },
};

export function getToolDefinitions(): ToolDefinition[] {
  return Object.values(tools).map((t) => t.definition);
}

export function isValidTool(name: string): name is ToolName {
  return name in tools;
}

export {
  executeRead,
  executeGlob,
  executeGrep,
  executeBash,
  executeWrite,
  executeEdit,
};
