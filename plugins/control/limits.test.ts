import { expect, test } from "bun:test";
import { createLimiter } from "./limits.server";

test("limiter runs at most max tasks at once and keeps arrival order", async () => {
  const limit = createLimiter(2);
  let active = 0;
  let peak = 0;
  const order: number[] = [];
  const task = (n: number): Promise<number> =>
    limit(async () => {
      order.push(n);
      active++;
      peak = Math.max(peak, active);
      await Bun.sleep(5);
      active--;
      return n;
    });
  const results = await Promise.all([1, 2, 3, 4, 5, 6].map(task));
  expect(results).toEqual([1, 2, 3, 4, 5, 6]);
  expect(order).toEqual([1, 2, 3, 4, 5, 6]);
  expect(peak).toBe(2);
});

test("limiter frees its slot when a task throws", async () => {
  const limit = createLimiter(1);
  await expect(limit(() => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
  expect(await limit(async () => "next")).toBe("next");
});
