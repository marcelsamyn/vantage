import { afterEach, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { diskMemo, memo, pruneMemo } from "./cache";

afterEach(() => {
  setSystemTime();
  pruneMemo(Infinity);
});

test("a failed load is not retried for a minute, and the error is shared meanwhile", async () => {
  let calls = 0;
  const failing = async (): Promise<number> => {
    calls++;
    throw new Error("rate limited");
  };
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  await expect(memo("t:fail", 10_000, failing)).rejects.toThrow("rate limited");
  await expect(memo("t:fail", 10_000, failing)).rejects.toThrow("rate limited");
  expect(calls).toBe(1);

  setSystemTime(new Date("2026-01-01T00:00:11Z"));
  await expect(memo("t:fail", 10_000, failing)).rejects.toThrow("rate limited");
  expect(calls).toBe(2);
});

test("a failed refresh serves the stale value without asking the source again", async () => {
  let calls = 0;
  let fail = false;
  const load = async (): Promise<string> => {
    calls++;
    if (fail) throw new Error("down");
    return "fresh";
  };
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  expect(await memo("t:stale", 1_000, load)).toBe("fresh");
  fail = true;
  setSystemTime(new Date("2026-01-01T00:00:02Z"));
  expect(await memo("t:stale", 1_000, load)).toBe("fresh");
  expect(await memo("t:stale", 1_000, load)).toBe("fresh");
  expect(calls).toBe(2);
});

test("entries past their stale window are pruned", async () => {
  let calls = 0;
  const load = async (): Promise<number> => ++calls;
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  await memo("t:prune", 1_000, load, 5_000);
  pruneMemo(Date.parse("2026-01-01T00:00:04Z"));
  setSystemTime(new Date("2026-01-01T00:00:00.500Z"));
  expect(await memo("t:prune", 1_000, load, 5_000)).toBe(1);
  pruneMemo(Date.parse("2026-01-01T00:00:06Z"));
  expect(await memo("t:prune", 1_000, load, 5_000)).toBe(2);
});

test("the least recently used entry leaves first when the map is full", async () => {
  const load = (n: number) => async (): Promise<number> => n;
  setSystemTime(new Date("2026-01-01T00:00:00Z"));
  await memo("t:lru:first", 60_000, load(1));
  for (let i = 0; i < 2_000; i++) await memo(`t:lru:${i}`, 60_000, load(i));
  let reloaded = false;
  await memo("t:lru:first", 60_000, async () => {
    reloaded = true;
    return 1;
  });
  expect(reloaded).toBe(true);
});

const CACHE_DIR = join(import.meta.dir, "..", "..", ".cache");
const written: string[] = [];

/** A cache file of this test's own, in the directory `diskMemo` reads. */
function fileFor(name: string): string {
  const path = join(CACHE_DIR, `cache-test-${name}-${Math.random().toString(36).slice(2)}.json`);
  written.push(path);
  return path;
}

const keyOf = (path: string): string => basename(path, ".json");

afterEach(async () => {
  await Promise.all(written.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const Record = z.object({ id: z.string(), name: z.string() });

test("a stored record that no longer fits the code reads the source again, and the file is replaced", async () => {
  const path = fileFor("shape");
  // Written by a build before `name` existed, and still inside its week.
  await Bun.write(path, JSON.stringify({ at: Date.now(), value: { id: "bird-rome" } }));
  let calls = 0;
  const load = async (): Promise<z.infer<typeof Record>> => {
    calls++;
    return { id: "bird-rome", name: "Bird Rome" };
  };

  expect(await diskMemo(keyOf(path), 7 * 86_400_000, load, Record)).toEqual({ id: "bird-rome", name: "Bird Rome" });
  expect(calls).toBe(1);
  expect(await Bun.file(path).json()).toMatchObject({ value: { id: "bird-rome", name: "Bird Rome" } });
});

test("a stored record that still fits is served without asking the source", async () => {
  const path = fileFor("fits");
  await Bun.write(path, JSON.stringify({ at: Date.now(), value: { id: "bird-rome", name: "Bird Rome" } }));
  let calls = 0;
  const load = async (): Promise<z.infer<typeof Record>> => {
    calls++;
    return { id: "bird-rome", name: "fetched" };
  };

  expect(await diskMemo(keyOf(path), 7 * 86_400_000, load, Record)).toEqual({ id: "bird-rome", name: "Bird Rome" });
  expect(calls).toBe(0);
});

test("a cache file that is not readable JSON counts as absent", async () => {
  const path = fileFor("truncated");
  await Bun.write(path, '{"at":1791523291255,"value":{"id":"bird');
  let calls = 0;
  const load = async (): Promise<string> => {
    calls++;
    return "fresh";
  };

  expect(await diskMemo(keyOf(path), 60_000, load, z.string())).toBe("fresh");
  expect(calls).toBe(1);
});

const START = Date.parse("2026-01-01T00:00:00Z");

test("reading disk does not restart the freshness clock", async () => {
  const path = fileFor("age");
  await Bun.write(path, JSON.stringify({ at: START, value: "stored" }));
  let calls = 0;
  const load = async (): Promise<string> => {
    calls++;
    return "new";
  };
  setSystemTime(START + 900);
  expect(await diskMemo(keyOf(path), 1_000, load, z.string())).toBe("stored");
  setSystemTime(START + 1_000);
  expect(await diskMemo(keyOf(path), 1_000, load, z.string())).toBe("new");
  expect(calls).toBe(1);
});

test("a failed disk refresh keeps the retry pause without making stale data fresh", async () => {
  const path = fileFor("retry");
  await Bun.write(path, JSON.stringify({ at: START, value: "stored" }));
  let calls = 0;
  const load = async (): Promise<string> => {
    calls++;
    throw new Error("offline");
  };
  setSystemTime(START + 2_000);
  expect(await diskMemo(keyOf(path), 10_000, load, z.string())).toBe("stored");
  setSystemTime(START + 11_000);
  expect(await diskMemo(keyOf(path), 10_000, load, z.string())).toBe("stored");
  expect(calls).toBe(1);
  setSystemTime(START + 20_999);
  expect(await diskMemo(keyOf(path), 10_000, load, z.string())).toBe("stored");
  expect(calls).toBe(1);
  setSystemTime(START + 21_000);
  expect(await diskMemo(keyOf(path), 10_000, load, z.string())).toBe("stored");
  expect(calls).toBe(2);
  expect(await Bun.file(path).json()).toEqual({ at: START, value: "stored" });
});

test("disk fallback stops at the default stale limit", async () => {
  const path = fileFor("too-old");
  await Bun.write(path, JSON.stringify({ at: START, value: "stored" }));
  setSystemTime(START + 10_000);
  await expect(diskMemo(keyOf(path), 1_000, async () => { throw new Error("offline"); }, z.string())).rejects.toThrow("offline");
});

test("a slow failed refresh cannot return a value that expired while loading", async () => {
  setSystemTime(START);
  await memo("t:slow", 1_000, async () => "stored", 5_000);
  setSystemTime(START + 4_000);
  await expect(memo("t:slow", 1_000, async () => {
    setSystemTime(START + 5_000);
    throw new Error("timeout");
  }, 5_000)).rejects.toThrow("timeout");
});

test("concurrent memory misses share one load", async () => {
  let calls = 0;
  const load = async (): Promise<number> => {
    calls++;
    await Promise.resolve();
    return calls;
  };
  expect(await Promise.all(Array.from({ length: 10 }, () => memo("t:concurrent", 1_000, load)))).toEqual(Array(10).fill(1));
  expect(calls).toBe(1);
});

test("concurrent disk misses share one load and persist the result", async () => {
  const path = fileFor("concurrent");
  let calls = 0;
  const load = async (): Promise<number> => ++calls;
  expect(await Promise.all(Array.from({ length: 10 }, () => diskMemo(keyOf(path), 1_000, load, z.number())))).toEqual(Array(10).fill(1));
  expect(calls).toBe(1);
  expect(await Bun.file(path).json()).toMatchObject({ value: 1 });
});

test("a loader that throws before returning a promise still gets a retry pause", async () => {
  setSystemTime(START);
  let calls = 0;
  const load = (): Promise<number> => {
    calls++;
    throw new Error("failed before await");
  };
  await expect(memo("t:sync-failure", 1_000, load)).rejects.toThrow("failed before await");
  await expect(memo("t:sync-failure", 1_000, load)).rejects.toThrow("failed before await");
  expect(calls).toBe(1);
});

test("remembered failures have a size limit too", async () => {
  setSystemTime(START);
  let calls = 0;
  const load = async (): Promise<number> => {
    calls++;
    throw new Error("offline");
  };
  for (let i = 0; i <= 2_000; i++) await expect(memo(`t:failure-limit:${i}`, 60_000, load)).rejects.toThrow("offline");
  await expect(memo("t:failure-limit:0", 60_000, load)).rejects.toThrow("offline");
  expect(calls).toBe(2_002);
});

test("a failed disk write does not discard a successful upstream response", async () => {
  const path = fileFor("write-failure");
  // An occupied directory forces the final write or rename to fail on a real filesystem.
  await mkdir(path);
  await Bun.write(join(path, "kept"), "untouched");
  expect(await diskMemo(keyOf(path), 60_000, async () => "new", z.string())).toBe("new");
  expect(await Bun.file(join(path, "kept")).text()).toBe("untouched");
  expect((await readdir(CACHE_DIR)).filter((name) => name.startsWith(`${basename(path)}.`))).toEqual([]);
});

test("disk keys that used to share a filename stay separate after a restart", async () => {
  const base = keyOf(fileFor("keys"));
  const keys = [`${base}:a`, `${base}/a`, `${base}_a`, base.toUpperCase(), `${base}${"x".repeat(300)}`];
  for (const [i, key] of keys.entries()) {
    const name = /^[a-z0-9._-]{1,180}$/.test(key) ? key : `~${createHash("sha256").update(key).digest("hex")}`;
    written.push(join(CACHE_DIR, `${name}.json`));
    expect(await diskMemo(key, 60_000, async () => i, z.number())).toBe(i);
  }
  pruneMemo(Infinity);
  let calls = 0;
  for (const [i, key] of keys.entries()) {
    expect(await diskMemo(key, 60_000, async () => { calls++; return -1; }, z.number())).toBe(i);
  }
  expect(calls).toBe(0);
});

test("disk callers can forbid stale fallback", async () => {
  const path = fileFor("no-stale");
  await Bun.write(path, JSON.stringify({ at: START, value: "stored" }));
  setSystemTime(START + 1_000);
  await expect(diskMemo(keyOf(path), 1_000, async () => { throw new Error("offline"); }, z.string(), 1_000)).rejects.toThrow("offline");
});

test("a retry pause cannot extend the stale window", async () => {
  setSystemTime(START);
  await memo("t:stale-pause", 10_000, async () => "stored", 11_000);
  let calls = 0;
  const load = async (): Promise<string> => { calls++; throw new Error("offline"); };
  setSystemTime(START + 10_500);
  expect(await memo("t:stale-pause", 10_000, load, 11_000)).toBe("stored");
  setSystemTime(START + 11_000);
  await expect(memo("t:stale-pause", 10_000, load, 11_000)).rejects.toThrow("offline");
  expect(calls).toBe(1);
});

test("disk fallback also checks age after a slow load fails", async () => {
  const path = fileFor("slow-disk");
  await Bun.write(path, JSON.stringify({ at: START, value: "stored" }));
  setSystemTime(START + 9_000);
  await expect(diskMemo(keyOf(path), 1_000, async () => {
    setSystemTime(START + 10_000);
    throw new Error("timeout");
  }, z.string())).rejects.toThrow("timeout");
});

test("a timestamp in the future is not used as fresh data", async () => {
  const path = fileFor("future");
  setSystemTime(START);
  await Bun.write(path, JSON.stringify({ at: START + 1_000, value: "stored" }));
  expect(await diskMemo(keyOf(path), 60_000, async () => "new", z.string())).toBe("new");
  expect(await Bun.file(path).json()).toEqual({ at: START, value: "new" });
});

test("a successful disk refresh replaces the old file and leaves no temporary record", async () => {
  const path = fileFor("replace");
  setSystemTime(START + 2_000);
  await Bun.write(path, JSON.stringify({ at: START, value: "stored" }));
  expect(await diskMemo(keyOf(path), 1_000, async () => "new", z.string())).toBe("new");
  expect(await Bun.file(path).json()).toEqual({ at: START + 2_000, value: "new" });
  expect((await readdir(CACHE_DIR)).filter((name) => name.startsWith(`${basename(path)}.`))).toEqual([]);
});
