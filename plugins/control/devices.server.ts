import { HttpError, browseServiceTypes, browseServices, describe, log, memo, resolveHostIpv4, z } from "../../server/kit";
import type { Act, Driver, Endpoint } from "./driver.server";
import { DRIVERS } from "./drivers/index.server";
import { createLimiter } from "./limits.server";
import { MAX_PARALLEL, discoverFrom } from "./scan.server";
import { rememberEndpoints, rememberedEndpoints } from "./store.server";
import type { Capability, ControlDevices, Device } from "./types";

/**
 * Discovery, state and actions across every driver.
 *  - The network is browsed with mDNS at most once a minute, in the background, so a request never waits for it.
 *    What a scan finds is remembered for a week: printers often sleep through a scan and still answer IPP.
 *  - Each endpoint's state is read at most every 5 s.
 *  - A device can be controlled only if discovery found it, and only through capabilities it reported.
 */

const TYPES_WINDOW_MS = 1_500;
const SERVICES_WINDOW_MS = 2_500;
const RESOLVE_WINDOW_MS = 1_500;
const SCAN_EVERY_MS = 60_000;
const READ_TTL_MS = 5_000;
const FORGET_AFTER_MS = 7 * 24 * 60 * 60_000;

// ── Network scan ──────────────────────────────────────────────────

let scannedAt: number | null = null;
let attemptedAt = 0;
let scanProblem: string | null = null;
let scanning: Promise<void> | null = null;
/** Endpoint keys of the last scan, to log only when what the network announces changes. */
let lastFound = "";

async function scanNetwork(): Promise<void> {
  const wanted = new Set(DRIVERS.flatMap((d) => d.mdns ?? []));
  const present = (await browseServiceTypes(TYPES_WINDOW_MS)).filter((t) => wanted.has(t));
  const services = (await Promise.all(present.map((t) => browseServices(t, SERVICES_WINDOW_MS)))).flat();
  const found = await discoverFrom(DRIVERS, services, (host) => resolveHostIpv4(host, RESOLVE_WINDOW_MS));
  await rememberEndpoints(found, FORGET_AFTER_MS);
  const keys = found.map((e) => e.key).sort().join(",");
  if (keys !== lastFound) log.info("control scan found", { endpoints: found.map((e) => e.key) });
  lastFound = keys;
  scannedAt = Date.now();
  scanProblem = null;
}

/** Start a scan in the background when the last one is older than a minute, or when asked to. */
function ensureScan(force: boolean): void {
  if (scanning || (!force && Date.now() - attemptedAt < SCAN_EVERY_MS)) return;
  attemptedAt = Date.now();
  scanning = scanNetwork()
    .catch((err: unknown) => {
      scanProblem = `Could not browse your network: ${describe(err)}`;
      log.warn("control scan failed", { error: describe(err) });
    })
    .finally(() => {
      scanning = null;
    });
}

// ── Endpoints and state ───────────────────────────────────────────

const driverOf = (endpoint: Endpoint): Driver => {
  const driver = DRIVERS.find((d) => d.id === endpoint.driver);
  if (!driver) throw new HttpError(500, "unknown_driver", `No driver is registered for ${endpoint.name}.`);
  return driver;
};

/** Parts of this Mac (the Mac itself, running players, Shortcuts) are looked up on every read; that is cheap. */
const localEndpoints = (): Promise<Endpoint[]> =>
  memo("control:local", READ_TTL_MS, async () => (await Promise.all(DRIVERS.filter((d) => !d.mdns?.length).map((d) => d.discover([])))).flat());

async function endpoints(): Promise<Endpoint[]> {
  const [local, remembered] = await Promise.all([localEndpoints(), rememberedEndpoints()]);
  return [...local, ...remembered.sort((a, b) => a.key.localeCompare(b.key))];
}

/** A device that did not answer still appears, with the reason, so the user sees it went quiet. */
function silent(endpoint: Endpoint, err: unknown): Device {
  return { id: endpoint.key, kind: endpoint.kind, name: endpoint.name, group: endpoint.group, model: null, via: null, local: endpoint.local, online: false, problem: describe(err), pairing: null, capabilities: [] };
}

/** A read of a device on the network waits for one of a few slots, so many endpoints never mean many simultaneous requests. */
const limitReads = createLimiter(MAX_PARALLEL);
const reads = new Map<string, { at: number; devices: Promise<Device[]> }>();
const lastProblem = new Map<string, string>();

function readEndpoint(endpoint: Endpoint): Promise<Device[]> {
  const hit = reads.get(endpoint.key);
  if (hit && Date.now() - hit.at < READ_TTL_MS) return hit.devices;
  const devices = (async () => {
    try {
      const driver = driverOf(endpoint);
      const found = await (endpoint.local ? driver.read(endpoint) : limitReads(() => driver.read(endpoint)));
      lastProblem.delete(endpoint.key);
      return found;
    } catch (err) {
      // An app that quit between discovery and the read is gone, not broken.
      if (err instanceof HttpError && err.code === "closed") return [];
      // Log a silent device once per change of reason, not on every poll.
      if (lastProblem.get(endpoint.key) !== describe(err)) log.warn("control read failed", { endpoint: endpoint.key, error: describe(err) });
      lastProblem.set(endpoint.key, describe(err));
      return [silent(endpoint, err)];
    }
  })();
  reads.set(endpoint.key, { at: Date.now(), devices });
  return devices;
}

export async function listDevices(refresh: boolean): Promise<ControlDevices> {
  ensureScan(refresh);
  if (refresh) reads.clear();
  const devices = (await Promise.all((await endpoints()).map(readEndpoint))).flat();
  return { at: Date.now(), scannedAt, scanning: scanning !== null, scanProblem, devices };
}

// ── Actions ───────────────────────────────────────────────────────

/** Find a device by id. Ids are the endpoint key, or start with "<key>/" for devices behind a bridge. */
async function locate(deviceId: string): Promise<{ endpoint: Endpoint; driver: Driver; device: Device }> {
  const endpoint = (await endpoints()).find((e) => deviceId === e.key || deviceId.startsWith(`${e.key}/`));
  const device = endpoint && (await readEndpoint(endpoint)).find((d) => d.id === deviceId);
  if (!endpoint || !device) throw new HttpError(404, "unknown_device", "VANTAGE has not found that device on this Mac or your network. Rescan, then try again.");
  return { endpoint, driver: driverOf(endpoint), device };
}

async function fresh(endpoint: Endpoint, deviceId: string): Promise<Device> {
  reads.delete(endpoint.key);
  const device = (await readEndpoint(endpoint)).find((d) => d.id === deviceId);
  if (!device) throw new HttpError(410, "gone", "The device disappeared after the action.");
  return device;
}

const parseWith = <S extends z.ZodType>(schema: S, value: unknown, label: string): z.infer<S> => {
  const result = schema.safeParse(value);
  if (!result.success) throw new HttpError(400, "bad_value", `${label}: ${z.prettifyError(result.error)}`);
  return result.data;
};

/** Validate a value against the capability it is meant for. Read-only capabilities accept nothing. */
export function parseAct(capability: Capability, value: unknown): Act {
  const { label } = capability;
  switch (capability.kind) {
    case "switch":
      return { kind: "switch", capability, value: parseWith(z.boolean(), value, label) };
    case "level":
      return { kind: "level", capability, value: parseWith(z.number().int().min(0).max(100), value, label) };
    case "color":
      return { kind: "color", capability, value: parseWith(z.string().regex(/^#[0-9a-f]{6}$/i, "Expected a colour such as #ffaa00"), value, label) };
    case "media":
      return { kind: "media", capability, value: parseWith(z.enum(["playpause", "pause", "next", "previous"]), value, label) };
    case "choice": {
      const ids = capability.options.map((o) => o.id);
      return { kind: "choice", capability, value: parseWith(z.string().refine((id) => ids.includes(id), "Not one of the options"), value, label) };
    }
    case "action": {
      const schema = capability.input ? z.string().max(capability.input.maxLength).regex(/\S/, "Enter some text") : z.null();
      return { kind: "action", capability, value: parseWith(schema, value, label) };
    }
    case "supplies":
    case "info":
      throw new HttpError(400, "read_only", `${label} can only be read.`);
  }
}

export async function act(deviceId: string, capabilityId: string, value: unknown): Promise<Device> {
  const { endpoint, driver, device } = await locate(deviceId);
  if (!device.online) throw new HttpError(409, "offline", `${device.name} is not answering. ${device.problem ?? ""}`.trim());
  if (device.pairing && !device.pairing.paired) throw new HttpError(409, "not_paired", `${device.name} is not paired yet. ${device.pairing.prompt}`);
  const capability = device.capabilities.find((c) => c.id === capabilityId);
  if (!capability) throw new HttpError(404, "unknown_capability", `${device.name} has no control called "${capabilityId}".`);
  if (!driver.act) throw new HttpError(400, "read_only", `${device.name} can only be read.`);
  await driver.act(endpoint, device, parseAct(capability, value));
  log.info("control act", { device: deviceId, capability: capabilityId });
  return fresh(endpoint, deviceId);
}

export async function pair(deviceId: string): Promise<Device> {
  const { endpoint, driver, device } = await locate(deviceId);
  if (!device.online) throw new HttpError(409, "offline", `${device.name} is not answering, so it cannot pair. ${device.problem ?? ""}`.trim());
  if (!driver.pair || !device.pairing) throw new HttpError(400, "no_pairing", `${device.name} does not need pairing.`);
  await driver.pair(endpoint);
  log.info("control paired", { device: deviceId });
  return fresh(endpoint, deviceId);
}
