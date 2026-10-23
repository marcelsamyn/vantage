/**
 * Runs at most `max` tasks at once. Further tasks wait and start in the order they arrived. A finished task hands
 * its slot straight to the next waiting one, so a task that arrives at that moment cannot jump the queue.
 */
export function createLimiter(max: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async (task) => {
    if (active < max) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  };
}
