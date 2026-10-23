import { hostname } from "node:os";
import { HttpError, fetchJson, z } from "../../../server/kit";
import { deviceOf, type Act, type Driver, type Endpoint } from "../driver.server";
import { savePairing, secretsOf } from "../store.server";
import type { Capability, Device } from "../types";
import { createFingerprintGuard, peerFingerprint } from "./hue-trust.server";

/**
 * Philips Hue bridges, found by `_hue._tcp`, through the bridge's local API (v1). Pairing needs a press of the
 * bridge's link button; the username it returns stays in .data/control.json.
 *
 * Anyone on the network can announce a bridge id, so the id proves nothing. Pairing therefore stores the username
 * with the bridge's address and certificate fingerprint, and the username goes only to that address, and only while
 * the bridge still shows that certificate. A bridge seen at another address is shown as moved and gets no secrets.
 * A refusal from a bridge never deletes the pairing; pairing again replaces it.
 */

const TIMEOUT_MS = 4_000;
const SOURCE = "Hue Bridge";

// ── Colour ────────────────────────────────────────────────────────

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const toHex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("")}`;

/** sRGB hex to CIE xy, with the wide-gamut matrix Philips publishes for Hue. */
export function hexToXy(hex: string): [number, number] {
  const linear = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92;
  });
  const [r = 0, g = 0, b = 0] = linear;
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  const sum = X + Y + Z;
  // Black has no chromaticity; use the white point.
  if (sum === 0) return [0.3127, 0.329];
  return [Number((X / sum).toFixed(4)), Number((Y / sum).toFixed(4))];
}

/** CIE xy at full brightness to sRGB hex, for a swatch. */
export function xyToHex([x, y]: [number, number]): string {
  if (y === 0) return "#ffffff";
  const X = x / y;
  const Z = (1 - x - y) / y;
  const rgb = [X * 1.656492 - 0.354851 - Z * 0.255038, -X * 0.707196 + 1.655397 + Z * 0.036152, X * 0.051713 - 0.121364 + Z * 1.01153].map((v) => Math.max(0, v));
  const peak = Math.max(...rgb, 1e-9);
  const [r = 0, g = 0, b = 0] = rgb.map((v) => v / peak).map((v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
  return toHex(r, g, b);
}

/** A colour temperature in mireds to sRGB hex (Tanner Helland's fit to the blackbody curve). */
export function miredToHex(mired: number): string {
  const t = 1_000_000 / mired / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return toHex(r / 255, g / 255, b / 255);
}

// ── API shapes ────────────────────────────────────────────────────

const hueError = z.object({ error: z.object({ type: z.number(), description: z.string() }) });
const errorList = z.array(hueError).min(1);

const configSchema = z.object({ name: z.string(), bridgeid: z.string(), modelid: z.string(), apiversion: z.string() });

const lightSchema = z.object({
  name: z.string(),
  type: z.string(),
  productname: z.string().optional(),
  modelid: z.string().optional(),
  state: z.object({
    on: z.boolean(),
    bri: z.number().optional(),
    xy: z.tuple([z.number(), z.number()]).optional(),
    ct: z.number().optional(),
    colormode: z.string().optional(),
    reachable: z.boolean(),
  }),
});
const lightsSchema = z.union([errorList, z.record(z.string(), lightSchema)]);
const groupsSchema = z.union([errorList, z.record(z.string(), z.object({ name: z.string(), type: z.string(), lights: z.array(z.string()) }))]);
const scenesSchema = z.union([errorList, z.record(z.string(), z.object({ name: z.string(), type: z.string().optional(), group: z.string().optional(), recycle: z.boolean().optional() }))]);
const writeSchema = z.array(z.union([hueError, z.object({ success: z.unknown() })]));
const pairSchema = z.array(z.union([hueError, z.object({ success: z.object({ username: z.string() }) })])).min(1);

const MODELS: Record<string, string> = { BSB001: "Hue Bridge (1st generation)", BSB002: "Hue Bridge (2nd generation)", BSB003: "Hue Bridge Pro" };

// ── Requests ──────────────────────────────────────────────────────

async function request<S extends z.ZodType>(baseUrl: string, path: string, schema: S, write?: { method: "PUT" | "POST"; body: unknown }): Promise<z.infer<S>> {
  // A variable, not a literal: `tls` is a Bun extension of fetch options that the kit's init type does not list.
  // The certificate is pinned separately (see ./hue-trust.server), so the chain is not checked here. Redirects fail:
  // a device on the network must not send VANTAGE to another address, such as this server's own API.
  const init: BunFetchRequestInit & { timeoutMs: number } = {
    timeoutMs: TIMEOUT_MS,
    redirect: "error",
    tls: { rejectUnauthorized: false },
    ...(write ? { method: write.method, body: JSON.stringify(write.body), headers: { "content-type": "application/json" } } : {}),
  };
  return fetchJson(SOURCE, `${baseUrl}${path}`, schema, init);
}

const isError = <T>(value: T | z.infer<typeof errorList>): value is z.infer<typeof errorList> => Array.isArray(value);
const UNAUTHORIZED = 1;
const LINK_BUTTON_NOT_PRESSED = 101;
const PAIR_PROMPT = "Press the round link button on top of the bridge, then select Pair within 30 seconds.";

const guard = createFingerprintGuard();

/** Why VANTAGE will not send a bridge its username. `problem` is null for a bridge that was never paired. */
interface Blocked {
  ok: false;
  problem: string | null;
}
interface Ready {
  ok: true;
  /** The address the bridge was paired at. */
  url: string;
  username: string;
}

/** Decide whether the username may go to this endpoint. It may only when address and certificate are those of the pairing. */
async function accessOf(endpoint: Endpoint): Promise<Ready | Blocked> {
  const { username, address, fingerprint } = await secretsOf(endpoint.key);
  if (!username) return { ok: false, problem: null };
  if (!address || !fingerprint) return { ok: false, problem: "VANTAGE paired before it pinned the bridge's address and certificate. Pair again to pin them." };
  if (endpoint.movedTo !== undefined || endpoint.url !== address) return { ok: false, problem: "Moved. Pair again to trust the new address." };
  if (!(await guard.matches(endpoint.key, address, fingerprint))) return { ok: false, problem: "The bridge shows a different certificate than when it was paired. Pair again to trust it." };
  return { ok: true, url: address, username };
}

async function write(endpoint: Endpoint, path: string, body: unknown): Promise<void> {
  const access = await accessOf(endpoint);
  if (!access.ok) throw new HttpError(409, "not_paired", access.problem ? `${endpoint.name} cannot be controlled. ${access.problem}` : `${endpoint.name} is not paired yet. Select Pair first.`);
  const results = await request(access.url, `/api/${access.username}${path}`, writeSchema, { method: "PUT", body });
  const failed = results.find((r) => "error" in r);
  if (failed && "error" in failed) throw new HttpError(502, "hue_refused", `The Hue Bridge refused the change: ${failed.error.description}.`);
}

// ── Devices ───────────────────────────────────────────────────────

type Light = z.infer<typeof lightSchema>;

function lightDevice(endpoint: Endpoint, id: string, light: Light, room: string | undefined): Device {
  const { state } = light;
  const capabilities: Capability[] = [{ kind: "switch", id: "power", label: "Power", on: state.on, ...(state.on && state.reachable ? { blackout: `Turn off ${light.name}` } : {}) }];
  if (state.bri !== undefined) capabilities.push({ kind: "level", id: "brightness", label: "Brightness", value: Math.round((state.bri / 254) * 100) });
  if (state.xy) capabilities.push({ kind: "color", id: "color", label: "Colour", hex: state.colormode === "ct" && state.ct ? miredToHex(state.ct) : xyToHex(state.xy) });
  return {
    id: `${endpoint.key}/light/${id}`,
    kind: "light",
    name: light.name,
    group: room ?? "Lights",
    model: light.productname ?? light.modelid ?? null,
    via: endpoint.key,
    local: false,
    online: state.reachable,
    problem: state.reachable ? null : "The bridge cannot reach this light. It may be switched off at the wall.",
    pairing: null,
    capabilities,
  };
}

export const hue: Driver = {
  id: "hue",
  mdns: ["_hue._tcp"],

  async discover(seen): Promise<Endpoint[]> {
    return seen.map((s) => {
      const bridgeId = (s.txt["bridgeid"] ?? s.host.replace(/\.local$/i, "")).toLowerCase();
      return {
        key: `hue:${bridgeId}`,
        driver: "hue",
        kind: "hub",
        name: s.name,
        group: "Lights",
        local: false,
        url: `https://${s.ip}:${s.port || 443}`,
        meta: { ip: s.ip },
        seenAt: Date.now(),
      };
    });
  },

  async read(endpoint): Promise<Device[]> {
    if (!endpoint.url) throw new HttpError(500, "no_address", `${endpoint.name} has no address yet. Rescan your network.`);
    const access = await accessOf(endpoint);
    const hostOf = (url: string): string => new URL(url).hostname;
    const unpairedPrompt = (problem: string | null): { prompt: string; action: string } => ({ prompt: problem ? `${problem} ${PAIR_PROMPT}` : PAIR_PROMPT, action: "Pair" });

    // A bridge that cannot be trusted is not contacted at all, so nothing it says can reach the user as fact.
    if (!access.ok && access.problem) {
      const address: Capability = { kind: "info", id: "about", label: "About", rows: [["Address", hostOf(endpoint.url)]] };
      return [deviceOf(endpoint, { pairing: { ...unpairedPrompt(access.problem), paired: false }, capabilities: [address], problem: access.problem })];
    }

    const url = access.ok ? access.url : endpoint.url;
    const config = await request(url, "/api/config", configSchema);
    const about = (lightCount: number | null): Capability => {
      const rows: [string, string][] = [
        ["Model", MODELS[config.modelid] ?? config.modelid],
        ["API", config.apiversion],
        ["Address", hostOf(url)],
      ];
      if (lightCount !== null) rows.push(["Lights", String(lightCount)]);
      return { kind: "info", id: "about", label: "About", rows };
    };
    const bridge = (paired: boolean, capabilities: Capability[], problem: string | null = null): Device =>
      deviceOf(endpoint, { name: config.name, model: MODELS[config.modelid] ?? config.modelid, pairing: { ...unpairedPrompt(null), paired }, capabilities, problem });

    if (!access.ok) return [bridge(false, [about(null)])];

    const base = `/api/${access.username}`;
    const [lights, groups, scenes] = await Promise.all([request(url, `${base}/lights`, lightsSchema), request(url, `${base}/groups`, groupsSchema), request(url, `${base}/scenes`, scenesSchema)]);
    if (isError(lights) || isError(groups) || isError(scenes)) {
      const error = [lights, groups, scenes].find(isError)?.[0]?.error;
      if (error?.type !== UNAUTHORIZED) throw new HttpError(502, "hue_refused", `The Hue Bridge refused to answer: ${error?.description ?? "unknown error"}.`);
      // The user may have removed VANTAGE in the Hue app. The pairing stays until the user pairs again: an answer on
      // the network is not proof enough to delete it.
      return [bridge(false, [about(null)], "The bridge does not accept VANTAGE's username. Pair again.")];
    }

    const roomOf = new Map<string, string>();
    for (const g of Object.values(groups)) if (g.type === "Room") for (const id of g.lights) roomOf.set(id, g.name);

    const sceneOptions = Object.entries(scenes)
      .filter(([, s]) => !s.recycle)
      .map(([id, s]) => {
        // Group scenes are recalled on their room; older light scenes on group 0, which spans all lights.
        const group = s.type === "GroupScene" && s.group ? s.group : "0";
        const room = group === "0" ? null : groups[group]?.name;
        return { id: `${group}/${id}`, label: room ? `${room} · ${s.name}` : s.name };
      })
      .sort((a, b) => a.label.localeCompare(b.label));

    const capabilities: Capability[] = [about(Object.keys(lights).length)];
    if (sceneOptions.length) capabilities.push({ kind: "choice", id: "scene", label: "Scene", options: sceneOptions, current: null });

    return [bridge(true, capabilities), ...Object.entries(lights).map(([id, light]) => lightDevice(endpoint, id, light, roomOf.get(id)))];
  },

  async act(endpoint, device, act: Act): Promise<void> {
    if (device.id === endpoint.key && act.kind === "choice" && act.capability.id === "scene") {
      const [group, scene] = act.value.split("/");
      return write(endpoint, `/groups/${group}/action`, { scene });
    }
    const light = /\/light\/(\d+)$/.exec(device.id)?.[1];
    if (!light) throw new HttpError(400, "unsupported", `${device.name} cannot do "${act.capability.label}".`);
    const path = `/lights/${light}/state`;
    switch (act.kind) {
      case "switch":
        return write(endpoint, path, { on: act.value });
      case "level":
        return write(endpoint, path, { on: true, bri: Math.max(1, Math.round((act.value / 100) * 254)) });
      case "color":
        return write(endpoint, path, { on: true, xy: hexToXy(act.value) });
      default:
        throw new HttpError(400, "unsupported", `${device.name} cannot do "${act.capability.label}".`);
    }
  },

  async pair(endpoint): Promise<void> {
    // A moved bridge is paired at the address a scan saw it at; that address becomes the one the username may go to.
    const url = endpoint.movedTo ?? endpoint.url;
    if (!url) throw new HttpError(500, "no_address", `${endpoint.name} has no address yet. Rescan your network.`);
    const fingerprint = await peerFingerprint(url);
    // The Hue API allows 19 characters after the "#".
    const devicetype = `vantage#${(hostname().split(".")[0] ?? "mac").slice(0, 19)}`;
    const [first] = await request(url, "/api", pairSchema, { method: "POST", body: { devicetype } });
    if (first && "success" in first) return savePairing(endpoint.key, { username: first.success.username, address: url, fingerprint }, url);
    if (first?.error.type === LINK_BUTTON_NOT_PRESSED) throw new HttpError(409, "link_button", "The link button was not pressed. Press the round button on top of the bridge, then select Pair within 30 seconds.");
    throw new HttpError(502, "hue_refused", `The Hue Bridge refused to pair: ${first?.error.description ?? "no answer"}.`);
  },
};
