import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store reads its folder when it loads, so point it at a temporary folder before importing it.
process.env["VANTAGE_CONTROL_DIR"] ??= mkdtempSync(join(tmpdir(), "vantage-control-"));
const { discoverFrom, MAX_PARALLEL, MAX_SIGHTINGS_PER_DRIVER } = await import("./scan.server");
const { printer } = await import("./drivers/printer.server");
const { hue } = await import("./drivers/hue.server");
const { MAX_ENDPOINTS, rememberEndpoints, rememberedEndpoints, savePairing } = await import("./store.server");
type Endpoint = Awaited<ReturnType<typeof printer.discover>>[number];
type MdnsService = Parameters<typeof discoverFrom>[1][number];

const flood = (type: string, count: number): MdnsService[] =>
  Array.from({ length: count }, (_, i) => ({ type, name: `Printer ${i}`, host: `host-${type}-${i}.local`, port: 631, txt: { uuid: `uuid-${type}-${i}` } }));

/** Counts lookups and how many ran at once, like `dns-sd` processes would. */
function fakeResolver() {
  const stats = { calls: 0, active: 0, peak: 0 };
  const addressesOf = async (host: string): Promise<string[]> => {
    stats.calls++;
    stats.active++;
    stats.peak = Math.max(stats.peak, stats.active);
    await Bun.sleep(2);
    stats.active--;
    return [`192.168.${stats.calls % 200}.${(host.length % 200) + 1}`];
  };
  return { stats, addressesOf };
}

test("a flood of 5000 printer announcements makes at most 32 lookups, 4 at a time", async () => {
  const { stats, addressesOf } = fakeResolver();
  const found = await discoverFrom([printer], flood("_ipp._tcp", 5000), addressesOf);
  expect(stats.calls).toBe(MAX_SIGHTINGS_PER_DRIVER);
  expect(stats.peak).toBeLessThanOrEqual(MAX_PARALLEL);
  expect(MAX_PARALLEL).toBe(4);
  expect(found).toHaveLength(32);
});

test("the cap holds per driver, across every type the driver browses", async () => {
  const { stats, addressesOf } = fakeResolver();
  const services = [...flood("_ipp._tcp", 100), ...flood("_ipps._tcp", 100), ...flood("_hue._tcp", 100)];
  const found = await discoverFrom([printer, hue], services, addressesOf);
  expect(stats.calls).toBe(64);
  expect(found.filter((e) => e.driver === "printer").length).toBeLessThanOrEqual(32);
  expect(found.filter((e) => e.driver === "hue")).toHaveLength(32);
});

test("an announcement that resolves to a public address is dropped", async () => {
  const found = await discoverFrom([printer], flood("_ipp._tcp", 3), async () => ["8.8.8.8"]);
  expect(found).toEqual([]);
});

const endpoint = (key: string, seenAt: number, url = `https://10.0.0.1/${key}`): Endpoint => ({ key, driver: "printer", kind: "printer", name: key, group: "Printers", local: false, url, meta: {}, seenAt });

test("the store keeps at most 64 endpoints and drops the oldest unpaired first", async () => {
  const now = Date.now();
  await savePairing("cap:paired", { username: "u", address: "https://10.0.0.9", fingerprint: "AA" }, "https://10.0.0.9");
  await rememberEndpoints([endpoint("cap:paired", now - 50_000, "https://10.0.0.9")], 60_000);
  const flooded = Array.from({ length: 200 }, (_, i) => endpoint(`cap:flood-${i}`, now - 1_000 + i));
  await rememberEndpoints(flooded, 60_000);

  const kept = (await rememberedEndpoints()).map((e) => e.key);
  expect(kept.length).toBeLessThanOrEqual(MAX_ENDPOINTS);
  expect(MAX_ENDPOINTS).toBe(64);
  // The paired endpoint is the oldest of all, and still survives the flood.
  expect(kept).toContain("cap:paired");
  expect(kept).toContain("cap:flood-199");
  expect(kept).not.toContain("cap:flood-0");
});

test("a scan that sees a paired key elsewhere keeps the paired address and notes the new one", async () => {
  const now = Date.now();
  await savePairing("moved:one", { username: "u", address: "https://10.0.0.5", fingerprint: "AA" }, "https://10.0.0.5");
  await rememberEndpoints([endpoint("moved:one", now, "https://10.0.0.5")], 60_000);
  await rememberEndpoints([endpoint("moved:one", now + 1, "https://10.0.0.66")], 60_000);
  const stored = (await rememberedEndpoints()).find((e) => e.key === "moved:one");
  expect(stored?.url).toBe("https://10.0.0.5");
  expect(stored?.movedTo).toBe("https://10.0.0.66");

  // A copycat announced beside the real bridge does not mark it as moved.
  await rememberEndpoints([endpoint("moved:one", now + 2, "https://10.0.0.66"), endpoint("moved:one", now + 2, "https://10.0.0.5")], 60_000);
  const again = (await rememberedEndpoints()).find((e) => e.key === "moved:one");
  expect(again?.url).toBe("https://10.0.0.5");
  expect(again?.movedTo).toBeUndefined();
});

test("an unpaired endpoint follows its new address", async () => {
  const now = Date.now();
  await rememberEndpoints([endpoint("free:one", now, "https://10.0.0.7")], 60_000);
  await rememberEndpoints([endpoint("free:one", now + 1, "https://10.0.0.8")], 60_000);
  expect((await rememberedEndpoints()).find((e) => e.key === "free:one")?.url).toBe("https://10.0.0.8");
});
