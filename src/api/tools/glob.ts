import * as fs from 'fs/promises';
import * as path from 'path';

export interface GlobInput {
  pattern: string;
  path?: string;
}

/**
 * Simple glob implementation for file pattern matching.
 * Supports basic patterns like "*.ts", "**\/*.js", "src/**\/*.tsx"
 */
export async function executeGlob(input: GlobInput, cwd: string): Promise<string> {
  const searchPath = input.path
    ? path.isAbsolute(input.path)
      ? input.path
      : path.join(cwd, input.path)
    : cwd;

  const pattern = input.pattern;
  const results: string[] = [];

  async function walkDir(dir: string, depth: number = 0): Promise<void> {
    if (depth > 20) return; // Prevent infinite recursion

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(searchPath, fullPath);

        // Skip hidden directories and common ignores
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          // If pattern includes **, recurse into directories
          if (pattern.includes('**')) {
            await walkDir(fullPath, depth + 1);
          }
        } else if (entry.isFile()) {
          if (matchesPattern(relativePath, pattern)) {
            results.push(relativePath);
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  await walkDir(searchPath);

  // Sort by modification time (most recent first) - simplified: just sort alphabetically
  results.sort();

  if (results.length === 0) {
    return 'No files found matching the pattern.';
  }

  return results.slice(0, 500).join('\n');
}

/**
 * Simple pattern matching
 */
function matchesPattern(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  let regexPattern = pattern
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\./g, '\\.');

  // Handle patterns like "*.ts" that should match files in any subdirectory
  if (!pattern.includes('/') && !pattern.includes('**')) {
    regexPattern = `(.*/)?(${regexPattern})`;
  }

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

export const globToolDefinition = {
  name: 'Glob',
  description: 'Find files matching a glob pattern. Returns list of matching file paths.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Glob pattern to match files (e.g., "**/*.ts", "src/**/*.tsx")',
      },
      path: {
        type: 'string',
        description: 'Directory to search in. Defaults to working directory.',
      },
    },
    required: ['pattern'],
  },
};
