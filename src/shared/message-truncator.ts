import * as path from 'path';
import * as fs from 'fs';

export interface TruncateResult {
  text: string;
  wasTruncated: boolean;
  savedPath?: string;
}

export const PLATFORM_LIMITS: Record<string, number> = {
  discord: 4000,
  slack: 3800,
  line: 1400,
  telegram: 2900,
  email: 5000,
  teams: 900,
};

const TRUNCATION_NOTICE = '\n\n---\n⚠ Response truncated. Full result saved to .claude-result.md';

export function truncateWithSave(
  text: string,
  platform: string,
  workingDir: string,
): TruncateResult {
  const limit = PLATFORM_LIMITS[platform];
  if (!limit || text.length <= limit) {
    return { text, wasTruncated: false };
  }

  try {
    const resultPath = path.join(workingDir, '.claude-result.md');
    fs.writeFileSync(resultPath, text, 'utf-8');
  } catch (error) {
    console.error('Failed to save full result to .claude-result.md:', error);
  }

  const truncatedLength = limit - TRUNCATION_NOTICE.length;
  const truncatedText = text.slice(0, Math.max(0, truncatedLength)) + TRUNCATION_NOTICE;

  return {
    text: truncatedText,
    wasTruncated: true,
    savedPath: '.claude-result.md',
  };
}
