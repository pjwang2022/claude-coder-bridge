import * as fs from 'fs/promises';
import * as path from 'path';

export interface WriteInput {
  file_path: string;
  content: string;
}

/**
 * Write content to a file, creating directories as needed.
 * This is a dangerous tool that requires permission approval.
 */
export async function executeWrite(input: WriteInput, cwd: string): Promise<string> {
  const filePath = path.isAbsolute(input.file_path)
    ? input.file_path
    : path.join(cwd, input.file_path);

  // Create parent directories if they don't exist
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });

  // Check if file exists for reporting
  let existed = false;
  try {
    await fs.access(filePath);
    existed = true;
  } catch {
    // File doesn't exist
  }

  // Write the file
  await fs.writeFile(filePath, input.content, 'utf-8');

  const lines = input.content.split('\n').length;
  const bytes = Buffer.byteLength(input.content, 'utf-8');

  if (existed) {
    return `File overwritten: ${filePath} (${lines} lines, ${bytes} bytes)`;
  } else {
    return `File created: ${filePath} (${lines} lines, ${bytes} bytes)`;
  }
}

export const writeToolDefinition = {
  name: 'Write',
  description: 'Write content to a file. Creates the file if it does not exist, overwrites if it does.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to write (absolute or relative to working directory)',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['file_path', 'content'],
  },
};
