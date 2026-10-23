import { expect, test } from "bun:test";
import { createAwakeSetter } from "./drivers/mac.server";

/** A fake process table. Reading it takes a moment, as `ps` does, which is what lets two switches overlap. */
function fakeCaffeinate() {
  const running: string[] = [];
  const calls = { started: 0, stopped: [] as string[][] };
  const control = {
    async pids(): Promise<string[]> {
      const seen = [...running];
      await Bun.sleep(10);
      return seen;
    },
    start(): void {
      calls.started++;
      running.push(String(1000 + calls.started));
    },
    async stop(pids: string[]): Promise<void> {
      calls.stopped.push(pids);
      for (const pid of pids) running.splice(running.indexOf(pid), 1);
    },
  };
  return { running, calls, control };
}

test("two keep-awake requests at once start one caffeinate", async () => {
  const { running, calls, control } = fakeCaffeinate();
  const setAwake = createAwakeSetter(control);
  await Promise.all([setAwake(true), setAwake(true), setAwake(true)]);
  expect(calls.started).toBe(1);
  expect(running).toHaveLength(1);
});

test("on then off at once ends with nothing running", async () => {
  const { running, calls, control } = fakeCaffeinate();
  const setAwake = createAwakeSetter(control);
  await Promise.all([setAwake(true), setAwake(false), setAwake(true), setAwake(false)]);
  expect(calls.started).toBe(2);
  expect(running).toEqual([]);
});

test("off stops every caffeinate that is running", async () => {
  const { running, calls, control } = fakeCaffeinate();
  running.push("7", "8");
  await createAwakeSetter(control)(false);
  expect(calls.stopped).toEqual([["7", "8"]]);
  expect(running).toEqual([]);
});

test("a failed switch does not block the next one", async () => {
  const { calls, control } = fakeCaffeinate();
  let fail = true;
  const setAwake = createAwakeSetter({
    ...control,
    async pids() {
      if (fail) {
        fail = false;
        throw new Error("ps failed");
      }
      return control.pids();
    },
  });
  const first = setAwake(true);
  const second = setAwake(true);
  await expect(first).rejects.toThrow("ps failed");
  await second;
  expect(calls.started).toBe(1);
});
