export interface FileValidationResult {
  allowed: boolean;
  reason?: string;
  category: 'image' | 'audio' | 'text' | 'rejected';
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const AUDIO_EXTENSIONS = new Set(['ogg', 'mp3', 'wav', 'm4a', 'webm', 'aac']);
const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'json', 'csv', 'ts', 'js', 'py', 'yaml', 'yml',
  'toml', 'xml', 'html', 'css', 'sql', 'sh', 'go', 'rs', 'java',
  'kt', 'swift', 'c', 'cpp', 'h', 'rb', 'php', 'log', 'pdf',
]);
const BLOCKED_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'ps1', 'msi', 'dmg', 'app', 'jar', 'com', 'scr',
  'zip', 'tar', 'gz', 'rar', '7z',
  'docm', 'xlsm', 'pptm',
]);

const MAX_SIZE_BYTES = parseInt(process.env.MAX_ATTACHMENT_SIZE_MB || '10') * 1024 * 1024;

export function getFileExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot + 1).toLowerCase();
}

export function validateFile(filename: string, sizeBytes: number): FileValidationResult {
  if (sizeBytes > MAX_SIZE_BYTES) {
    const maxMB = MAX_SIZE_BYTES / (1024 * 1024);
    return { allowed: false, reason: `File too large (max ${maxMB}MB)`, category: 'rejected' };
  }

  const ext = getFileExtension(filename);

  if (BLOCKED_EXTENSIONS.has(ext)) {
    return { allowed: false, reason: `Unsupported file type: .${ext}`, category: 'rejected' };
  }

  if (IMAGE_EXTENSIONS.has(ext)) {
    return { allowed: true, category: 'image' };
  }

  if (AUDIO_EXTENSIONS.has(ext)) {
    return { allowed: true, category: 'audio' };
  }

  if (TEXT_EXTENSIONS.has(ext)) {
    return { allowed: true, category: 'text' };
  }

  return { allowed: false, reason: `Unknown file type: .${ext || '(none)'}`, category: 'rejected' };
}
