import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateFile, getFileExtension, type FileValidationResult } from '../../src/shared/file-validator';

describe('file-validator', () => {
  describe('getFileExtension', () => {
    it('should extract extension from filename', () => {
      expect(getFileExtension('image.png')).toBe('png');
      expect(getFileExtension('document.PDF')).toBe('pdf');
      expect(getFileExtension('archive.tar.gz')).toBe('gz');
    });

    it('should return empty string for files without extension', () => {
      expect(getFileExtension('readme')).toBe('');
      expect(getFileExtension('.hidden')).toBe('hidden'); // .hidden has extension 'hidden'
      expect(getFileExtension('file.')).toBe('');
    });

    it('should handle paths with multiple dots', () => {
      expect(getFileExtension('my.file.name.txt')).toBe('txt');
      expect(getFileExtension('v1.2.3.json')).toBe('json');
    });

    it('should return lowercase extension', () => {
      expect(getFileExtension('FILE.PNG')).toBe('png');
      expect(getFileExtension('Document.TxT')).toBe('txt');
    });
  });

  describe('validateFile', () => {
    const ONE_MB = 1024 * 1024;
    const DEFAULT_MAX_SIZE = 10 * ONE_MB; // Default from env var

    describe('image files', () => {
      it('should allow png files', () => {
        const result = validateFile('image.png', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
        expect(result.reason).toBeUndefined();
      });

      it('should allow jpg files', () => {
        const result = validateFile('photo.jpg', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
      });

      it('should allow jpeg files', () => {
        const result = validateFile('photo.jpeg', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
      });

      it('should allow gif files', () => {
        const result = validateFile('animation.gif', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
      });

      it('should allow webp files', () => {
        const result = validateFile('image.webp', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
      });
    });

    describe('audio files', () => {
      it('should allow ogg files', () => {
        const result = validateFile('audio.ogg', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('audio');
      });

      it('should allow mp3 files', () => {
        const result = validateFile('music.mp3', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('audio');
      });

      it('should allow wav files', () => {
        const result = validateFile('sound.wav', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('audio');
      });

      it('should allow m4a files', () => {
        const result = validateFile('voice.m4a', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('audio');
      });
    });

    describe('text files', () => {
      it('should allow txt files', () => {
        const result = validateFile('readme.txt', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('text');
      });

      it('should allow md files', () => {
        const result = validateFile('README.md', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('text');
      });

      it('should allow json files', () => {
        const result = validateFile('config.json', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('text');
      });

      it('should allow ts files', () => {
        const result = validateFile('index.ts', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('text');
      });

      it('should allow js files', () => {
        const result = validateFile('app.js', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('text');
      });

      it('should allow py files', () => {
        const result = validateFile('script.py', 1 * ONE_MB);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('text');
      });
    });

    describe('blocked extensions', () => {
      it('should reject exe files', () => {
        const result = validateFile('program.exe', 1 * ONE_MB);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('.exe');
      });

      it('should reject bat files', () => {
        const result = validateFile('script.bat', 1 * ONE_MB);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('.bat');
      });

      it('should reject zip files', () => {
        const result = validateFile('archive.zip', 1 * ONE_MB);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('.zip');
      });

      it('should reject rar files', () => {
        const result = validateFile('archive.rar', 1 * ONE_MB);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('.rar');
      });
    });

    describe('unknown extensions', () => {
      it('should reject unknown file types', () => {
        const result = validateFile('file.xyz', 1 * ONE_MB);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('Unknown file type');
        expect(result.reason).toContain('.xyz');
      });

      it('should reject files with no extension', () => {
        const result = validateFile('makefile', 1 * ONE_MB);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('(none)');
      });
    });

    describe('file size validation', () => {
      it('should reject files that are too large', () => {
        const result = validateFile('large.png', DEFAULT_MAX_SIZE + 1);
        expect(result.allowed).toBe(false);
        expect(result.category).toBe('rejected');
        expect(result.reason).toContain('File too large');
        expect(result.reason).toContain('10MB');
      });

      it('should allow files at exactly the size limit', () => {
        const result = validateFile('exact.png', DEFAULT_MAX_SIZE);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
      });

      it('should allow files just under the size limit', () => {
        const result = validateFile('just-under.png', DEFAULT_MAX_SIZE - 1);
        expect(result.allowed).toBe(true);
        expect(result.category).toBe('image');
      });

      it('should prioritize size check over extension check', () => {
        const result = validateFile('huge.png', DEFAULT_MAX_SIZE + 1);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('File too large');
      });
    });

    describe('case insensitivity', () => {
      it('should handle uppercase extensions', () => {
        expect(validateFile('IMAGE.PNG', 1 * ONE_MB).allowed).toBe(true);
        expect(validateFile('MUSIC.MP3', 1 * ONE_MB).allowed).toBe(true);
        expect(validateFile('CODE.TS', 1 * ONE_MB).allowed).toBe(true);
      });

      it('should handle mixed case extensions', () => {
        expect(validateFile('file.PnG', 1 * ONE_MB).allowed).toBe(true);
        expect(validateFile('audio.M4A', 1 * ONE_MB).allowed).toBe(true);
      });
    });
  });
});
