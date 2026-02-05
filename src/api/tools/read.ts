import * as fs from 'fs/promises';
import * as path from 'path';

export interface ReadInput {
  file_path: string;
  offset?: number;
  limit?: number;
}

/**
 * Read file contents with optional line offset and limit.
 * Returns content formatted with line numbers (similar to cat -n).
 */
export async function executeRead(input: ReadInput, cwd: string): Promise<string> {
  const filePath = path.isAbsolute(input.file_path)
    ? input.file_path
    : path.join(cwd, input.file_path);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const offset = input.offset || 0;
    const limit = input.limit || 2000;
    const selectedLines = lines.slice(offset, offset + limit);

    // Format with line numbers (cat -n style)
    return selectedLines
      .map((line, i) => {
        const lineNum = String(offset + i + 1).padStart(6, ' ');
        // Truncate long lines
        const truncatedLine = line.length > 2000 ? line.substring(0, 2000) + '...' : line;
        return `${lineNum}\t${truncatedLine}`;
      })
      .join('\n');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    if ((error as NodeJS.ErrnoException).code === 'EISDIR') {
      throw new Error(`Path is a directory, not a file: ${filePath}`);
    }
    throw error;
  }
}

export const readToolDefinition = {
  name: 'Read',
  description: 'Read the contents of a file. Returns file content with line numbers.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to read (absolute or relative to working directory)',
      },
      offset: {
        type: 'number',
        description: 'Line number to start reading from (0-based). Optional.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read. Default is 2000.',
      },
    },
    required: ['file_path'],
  },
};
