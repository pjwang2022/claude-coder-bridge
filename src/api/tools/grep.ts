import * as fs from 'fs/promises';
import * as path from 'path';

export interface GrepInput {
  pattern: string;
  path?: string;
  glob?: string;
  include_context?: number;
}

interface GrepMatch {
  file: string;
  line: number;
  content: string;
}

/**
 * Search for pattern in files.
 */
export async function executeGrep(input: GrepInput, cwd: string): Promise<string> {
  const searchPath = input.path
    ? path.isAbsolute(input.path)
      ? input.path
      : path.join(cwd, input.path)
    : cwd;

  const matches: GrepMatch[] = [];
  const regex = new RegExp(input.pattern, 'gi');
  const contextLines = input.include_context || 0;

  async function searchFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line !== undefined && regex.test(line)) {
          const relativePath = path.relative(cwd, filePath);

          if (contextLines > 0) {
            const start = Math.max(0, i - contextLines);
            const end = Math.min(lines.length - 1, i + contextLines);
            const contextContent = lines.slice(start, end + 1).join('\n');
            matches.push({
              file: relativePath,
              line: i + 1,
              content: contextContent,
            });
          } else {
            matches.push({
              file: relativePath,
              line: i + 1,
              content: line,
            });
          }
        }
        regex.lastIndex = 0; // Reset regex state
      }
    } catch {
      // Ignore files that can't be read
    }
  }

  async function walkDir(dir: string, depth: number = 0): Promise<void> {
    if (depth > 20) return;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        // Skip hidden and common ignores
        if (entry.name.startsWith('.') || entry.name === 'node_modules') {
          continue;
        }

        if (entry.isDirectory()) {
          await walkDir(fullPath, depth + 1);
        } else if (entry.isFile()) {
          // Check glob pattern if provided
          if (input.glob) {
            const relativePath = path.relative(searchPath, fullPath);
            if (!matchesGlob(relativePath, input.glob)) {
              continue;
            }
          }
          // Only search text files
          if (isTextFile(entry.name)) {
            await searchFile(fullPath);
          }
        }
      }
    } catch {
      // Ignore permission errors
    }
  }

  // If path is a file, search just that file
  const stat = await fs.stat(searchPath).catch(() => null);
  if (stat?.isFile()) {
    await searchFile(searchPath);
  } else {
    await walkDir(searchPath);
  }

  if (matches.length === 0) {
    return 'No matches found.';
  }

  // Limit results
  const limitedMatches = matches.slice(0, 100);

  return limitedMatches
    .map((m) => `${m.file}:${m.line}: ${m.content}`)
    .join('\n');
}

function matchesGlob(filePath: string, pattern: string): boolean {
  let regexPattern = pattern
    .replace(/\*\*/g, '{{DOUBLESTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/{{DOUBLESTAR}}/g, '.*')
    .replace(/\?/g, '.')
    .replace(/\./g, '\\.');

  if (!pattern.includes('/') && !pattern.includes('**')) {
    regexPattern = `(.*/)?(${regexPattern})`;
  }

  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

function isTextFile(filename: string): boolean {
  const textExtensions = [
    '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.txt', '.yml', '.yaml',
    '.css', '.scss', '.html', '.xml', '.sh', '.bash', '.zsh', '.py', '.rb',
    '.go', '.rs', '.java', '.c', '.cpp', '.h', '.hpp', '.sql', '.graphql',
    '.env', '.gitignore', '.dockerignore', 'Dockerfile', 'Makefile',
  ];
  return textExtensions.some((ext) => filename.endsWith(ext) || filename === ext);
}

export const grepToolDefinition = {
  name: 'Grep',
  description: 'Search for a pattern in files. Returns matching lines with file paths and line numbers.',
  input_schema: {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string',
        description: 'Regular expression pattern to search for',
      },
      path: {
        type: 'string',
        description: 'File or directory to search in. Defaults to working directory.',
      },
      glob: {
        type: 'string',
        description: 'Only search files matching this glob pattern (e.g., "*.ts")',
      },
      include_context: {
        type: 'number',
        description: 'Number of context lines to include before and after matches',
      },
    },
    required: ['pattern'],
  },
};
