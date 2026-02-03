export function createThrottle(minIntervalMs: number): <T>(fn: () => Promise<T>) => Promise<T> {
  let lastCall = 0;
  let pending: Promise<any> | null = null;

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    if (pending) await pending;

    const now = Date.now();
    const wait = Math.max(0, minIntervalMs - (now - lastCall));

    if (wait > 0) {
      await new Promise(resolve => setTimeout(resolve, wait));
    }

    lastCall = Date.now();
    const promise = fn();
    pending = promise;
    const result = await promise;
    pending = null;
    return result;
  };
}
