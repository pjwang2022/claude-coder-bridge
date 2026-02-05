import * as fs from 'fs/promises';
import * as path from 'path';

export interface EditInput {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

/**
 * Edit a file by replacing a specific string.
 * This is a dangerous tool that requires permission approval.
 */
export async function executeEdit(input: EditInput, cwd: string): Promise<string> {
  const filePath = path.isAbsolute(input.file_path)
    ? input.file_path
    : path.join(cwd, input.file_path);

  // Read the file
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`File not found: ${filePath}`);
    }
    throw error;
  }

  // Check if old_string exists
  const occurrences = content.split(input.old_string).length - 1;

  if (occurrences === 0) {
    throw new Error(`String not found in file: "${input.old_string.substring(0, 50)}${input.old_string.length > 50 ? '...' : ''}"`);
  }

  if (occurrences > 1 && !input.replace_all) {
    throw new Error(
      `Found ${occurrences} occurrences of the string. Use replace_all: true to replace all, or provide a more specific string to match exactly one occurrence.`
    );
  }

  // Perform replacement
  let newContent: string;
  let replacedCount: number;

  if (input.replace_all) {
    newContent = content.split(input.old_string).join(input.new_string);
    replacedCount = occurrences;
  } else {
    newContent = content.replace(input.old_string, input.new_string);
    replacedCount = 1;
  }

  // Write the file
  await fs.writeFile(filePath, newContent, 'utf-8');

  return `Edited ${filePath}: replaced ${replacedCount} occurrence${replacedCount > 1 ? 's' : ''}`;
}

export const editToolDefinition = {
  name: 'Edit',
  description: 'Edit a file by replacing a specific string with a new string. The old_string must be unique in the file unless replace_all is true.',
  input_schema: {
    type: 'object' as const,
    properties: {
      file_path: {
        type: 'string',
        description: 'The path to the file to edit (absolute or relative to working directory)',
      },
      old_string: {
        type: 'string',
        description: 'The exact string to replace. Must be unique in the file unless replace_all is true.',
      },
      new_string: {
        type: 'string',
        description: 'The string to replace it with',
      },
      replace_all: {
        type: 'boolean',
        description: 'If true, replace all occurrences of old_string. Default is false.',
      },
    },
    required: ['file_path', 'old_string', 'new_string'],
  },
};
