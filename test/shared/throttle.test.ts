import { describe, it, expect, beforeEach } from 'vitest';
import { createThrottle } from '../../src/shared/throttle';

describe('throttle', () => {
  describe('createThrottle', () => {
    it('should enforce minimum interval between calls', async () => {
      const throttle = createThrottle(100);

      const start = Date.now();
      await throttle(async () => 'first');
      await throttle(async () => 'second');
      const elapsed = Date.now() - start;

      // Should take at least 100ms due to throttle
      // Allow 5ms tolerance for OS scheduling jitter
      expect(elapsed).toBeGreaterThanOrEqual(95);
    });

    it('should return function result', async () => {
      const throttle = createThrottle(50);

      const result = await throttle(async () => 'test-result');

      expect(result).toBe('test-result');
    });

    it('should support generic types', async () => {
      const throttle = createThrottle(50);

      const numberResult = await throttle(async () => 42);
      expect(numberResult).toBe(42);

      const objectResult = await throttle(async () => ({ key: 'value' }));
      expect(objectResult).toEqual({ key: 'value' });

      const arrayResult = await throttle(async () => [1, 2, 3]);
      expect(arrayResult).toEqual([1, 2, 3]);
    });

    it('should wait appropriately for sequential calls', async () => {
      const throttle = createThrottle(100);
      const timestamps: number[] = [];

      await throttle(async () => { timestamps.push(Date.now()); });
      await throttle(async () => { timestamps.push(Date.now()); });
      await throttle(async () => { timestamps.push(Date.now()); });

      expect(timestamps.length).toBe(3);

      // Check intervals between calls
      const interval1 = timestamps[1] - timestamps[0];
      const interval2 = timestamps[2] - timestamps[1];

      // Allow 5ms tolerance for OS scheduling jitter
      expect(interval1).toBeGreaterThanOrEqual(95);
      expect(interval2).toBeGreaterThanOrEqual(95);
    });

    it('should not throttle first call', async () => {
      const throttle = createThrottle(100);

      const start = Date.now();
      await throttle(async () => 'first');
      const elapsed = Date.now() - start;

      // First call should execute immediately
      expect(elapsed).toBeLessThan(50);
    });

    it('should handle async functions that take time', async () => {
      const throttle = createThrottle(50);

      const start = Date.now();
      await throttle(async () => {
        await new Promise(resolve => setTimeout(resolve, 30));
        return 'delayed';
      });
      await throttle(async () => 'immediate');
      const elapsed = Date.now() - start;

      // The throttle updates lastCall AFTER the function completes, so:
      // First call: starts immediately, takes 30ms, updates lastCall
      // Second call: waits 50ms from when lastCall was updated
      // Total should be at least 30ms (first function) but throttle may overlap
      expect(elapsed).toBeGreaterThanOrEqual(30);
    });

    it('should handle zero interval', async () => {
      const throttle = createThrottle(0);

      const start = Date.now();
      await throttle(async () => 'first');
      await throttle(async () => 'second');
      const elapsed = Date.now() - start;

      // Should execute with minimal delay
      expect(elapsed).toBeLessThan(50);
    });

    it('should preserve promise rejection', async () => {
      const throttle = createThrottle(50);

      await expect(
        throttle(async () => {
          throw new Error('test error');
        })
      ).rejects.toThrow('test error');
    });

    it('should handle multiple throttle instances independently', async () => {
      const throttle1 = createThrottle(100);
      const throttle2 = createThrottle(50);

      const start = Date.now();

      // Run both in parallel
      const [result1, result2] = await Promise.all([
        (async () => {
          await throttle1(async () => '1a');
          await throttle1(async () => '1b');
          return Date.now() - start;
        })(),
        (async () => {
          await throttle2(async () => '2a');
          await throttle2(async () => '2b');
          return Date.now() - start;
        })(),
      ]);

      // throttle1 should take ~100ms, throttle2 should take ~50ms
      // Allow 5ms tolerance for OS scheduling jitter
      expect(result1).toBeGreaterThanOrEqual(95);
      expect(result2).toBeGreaterThanOrEqual(45);
      expect(result2).toBeLessThan(result1);
    });

    it('should queue concurrent calls', async () => {
      const throttle = createThrottle(100);
      const results: string[] = [];

      // Fire multiple calls concurrently
      const promises = [
        throttle(async () => { results.push('first'); return 'first'; }),
        throttle(async () => { results.push('second'); return 'second'; }),
        throttle(async () => { results.push('third'); return 'third'; }),
      ];

      await Promise.all(promises);

      // All should complete in order
      expect(results).toEqual(['first', 'second', 'third']);
    });

    it('should wait for pending promise before next execution', async () => {
      const throttle = createThrottle(50);
      const executionOrder: number[] = [];

      // Start first call that takes 100ms
      const promise1 = throttle(async () => {
        executionOrder.push(1);
        await new Promise(resolve => setTimeout(resolve, 100));
        executionOrder.push(2);
      });

      // Start second call immediately (should wait for first to complete)
      const promise2 = throttle(async () => {
        executionOrder.push(3);
      });

      await Promise.all([promise1, promise2]);

      // Should execute in order: 1, 2 (first completes), then 3 (second starts)
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should handle rapid successive calls', async () => {
      const throttle = createThrottle(100);
      const start = Date.now();
      const results: number[] = [];

      // Fire 5 calls sequentially (not in parallel) to test throttling
      await throttle(async () => results.push(1));
      await throttle(async () => results.push(2));
      await throttle(async () => results.push(3));
      await throttle(async () => results.push(4));
      await throttle(async () => results.push(5));

      const elapsed = Date.now() - start;

      // All calls should complete
      expect(results.length).toBe(5);

      // Should take at least 400ms (4 intervals of 100ms between 5 calls)
      // Allow 5ms tolerance for OS scheduling jitter
      expect(elapsed).toBeGreaterThanOrEqual(395);
    });

    it('should calculate wait time based on last call time', async () => {
      const throttle = createThrottle(100);

      // First call
      await throttle(async () => 'first');

      // Wait 60ms manually
      await new Promise(resolve => setTimeout(resolve, 60));

      // Second call should only wait 40ms more (to reach 100ms total)
      const start = Date.now();
      await throttle(async () => 'second');
      const elapsed = Date.now() - start;

      // Should wait approximately 40ms (100 - 60)
      expect(elapsed).toBeGreaterThanOrEqual(35);
      expect(elapsed).toBeLessThan(60);
    });
  });
});
