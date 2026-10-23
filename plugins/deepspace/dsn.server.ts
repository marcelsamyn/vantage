import { diskMemo, fetchUpstream, memo, parseUpstream, z } from "../../server/kit";
import { lightSecondsOver } from "./physics";
import type { ComplexId, DsnComplex, DsnDish, DsnLink, DsnSignal, DsnSnapshot, DsnTarget, SpacecraftRef } from "./types";

const SOURCE = "NASA Deep Space Network Now";
const DSN_URL = "https://eyes.nasa.gov/dsn/data/dsn.xml";
const CONFIG_URL = "https://eyes.nasa.gov/dsn/config.xml";

/** NASA's own page refreshes every 5 s; asking every 10 s keeps the local server a polite client. */
const READING_TTL_MS = 10_000;
const CONFIG_TTL_MS = 24 * 3_600_000;

/** Madrid first: it is the complex that faces Europe. */
const COMPLEX_ORDER: readonly ComplexId[] = ["mdscc", "gdscc", "cdscc"];
const isComplexId = (v: string): v is ComplexId => (COMPLEX_ORDER as readonly string[]).includes(v);

// ── A small XML reader ────────────────────────────────────────────
// Both feeds are flat lists of elements with attributes and no text content except <timestamp>.

interface Tag {
  name: string;
  attrs: Record<string, string>;
  closing: boolean;
  selfClosing: boolean;
}

const TAG = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
const ATTR = /([\w:-]+)\s*=\s*"([^"]*)"/g;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const decode = (s: string): string => s.replace(/&(?:amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m] ?? m);

export function scanTags(xml: string): Tag[] {
  const tags: Tag[] = [];
  for (const m of xml.matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const a of (m[3] ?? "").matchAll(ATTR)) attrs[a[1] as string] = decode(a[2] as string);
    tags.push({ name: m[2] as string, attrs, closing: m[1] === "/", selfClosing: m[4] === "/" });
  }
  return tags;
}

/** A number, or null for the empty, "NaN" and placeholder values the feed uses for "unknown". */
const toNum = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ── Raw feed shapes ───────────────────────────────────────────────

const stationAttrs = z.object({ name: z.string(), friendlyName: z.string(), timeUTC: z.string(), timeZoneOffset: z.string() });
const dishAttrs = z.object({
  name: z.string(),
  azimuthAngle: z.string(),
  elevationAngle: z.string(),
  windSpeed: z.string().default(""),
  isArray: z.string().default("false"),
  activity: z.string().default(""),
});
const signalAttrs = z.object({
  active: z.string(),
  signalType: z.string().default("none"),
  dataRate: z.string().default(""),
  band: z.string().default(""),
  power: z.string().default(""),
  spacecraft: z.string(),
  spacecraftID: z.string(),
});
const targetAttrs = z.object({ name: z.string(), id: z.string(), uplegRange: z.string().default("-1"), downlegRange: z.string().default("-1") });

interface RawDish {
  attrs: z.infer<typeof dishAttrs>;
  signals: { direction: "up" | "down"; attrs: z.infer<typeof signalAttrs> }[];
  targets: z.infer<typeof targetAttrs>[];
}
interface RawStation {
  attrs: z.infer<typeof stationAttrs>;
  dishes: RawDish[];
}
export interface RawReading {
  readingAt: number | null;
  stations: RawStation[];
}

export function parseReading(xml: string): RawReading {
  const stations: RawStation[] = [];
  let dish: RawDish | null = null;
  for (const tag of scanTags(xml)) {
    if (tag.closing) {
      if (tag.name === "dish") dish = null;
      continue;
    }
    switch (tag.name) {
      case "station":
        stations.push({ attrs: parseUpstream(SOURCE, stationAttrs, tag.attrs), dishes: [] });
        break;
      case "dish": {
        const station = stations[stations.length - 1];
        if (!station) break;
        dish = { attrs: parseUpstream(SOURCE, dishAttrs, tag.attrs), signals: [], targets: [] };
        station.dishes.push(dish);
        if (tag.selfClosing) dish = null;
        break;
      }
      case "upSignal":
      case "downSignal":
        dish?.signals.push({ direction: tag.name === "upSignal" ? "up" : "down", attrs: parseUpstream(SOURCE, signalAttrs, tag.attrs) });
        break;
      case "target":
        dish?.targets.push(parseUpstream(SOURCE, targetAttrs, tag.attrs));
        break;
    }
  }
  const stamp = /<timestamp>\s*(\d+)\s*<\/timestamp>/.exec(xml)?.[1];
  return { readingAt: stamp ? Number(stamp) : null, stations };
}

// ── Static configuration: where the complexes are, how big the dishes are, what the codes mean ──

export interface DsnConfig {
  sites: Map<string, { name: string; latitude: number; longitude: number }>;
  dishSizeM: Map<string, 70 | 34>;
  /** Lower-case spacecraft code → friendly name. */
  names: Map<string, string>;
}

const siteAttrs = z.object({ name: z.string(), friendlyName: z.string(), latitude: z.string(), longitude: z.string() });
const configDishAttrs = z.object({ name: z.string(), type: z.string() });
const configCraftAttrs = z.object({ name: z.string(), friendlyName: z.string() });

export function parseConfig(xml: string): DsnConfig {
  const config: DsnConfig = { sites: new Map(), dishSizeM: new Map(), names: new Map() };
  for (const tag of scanTags(xml)) {
    if (tag.closing) continue;
    if (tag.name === "site") {
      const a = parseUpstream(SOURCE, siteAttrs, tag.attrs);
      config.sites.set(a.name, { name: a.friendlyName, latitude: Number(a.latitude), longitude: Number(a.longitude) });
    } else if (tag.name === "dish") {
      const a = parseUpstream(SOURCE, configDishAttrs, tag.attrs);
      config.dishSizeM.set(a.name, a.type.startsWith("70") ? 70 : 34);
    } else if (tag.name === "spacecraft") {
      const a = parseUpstream(SOURCE, configCraftAttrs, tag.attrs);
      config.names.set(a.name.toLowerCase(), a.friendlyName);
    }
  }
  return config;
}

// ── Normalising ───────────────────────────────────────────────────

/** Link distances come from JPL Horizons when it has the spacecraft, and from the network's own range otherwise. */
export type EarthDistance = (naifId: number) => number | null;

function craft(config: DsnConfig, code: string, id: string): SpacecraftRef {
  return { naifId: Number(id), name: config.names.get(code.toLowerCase()) ?? code };
}

function signalFrom(config: DsnConfig, raw: RawDish["signals"][number]): DsnSignal {
  const { direction, attrs } = raw;
  const power = toNum(attrs.power);
  const active = attrs.active === "true";
  return {
    direction,
    active,
    type: attrs.signalType,
    band: attrs.band,
    rateBps: toNum(attrs.dataRate) || null,
    // The feed reports -480 dBm for a receiver with nothing on it; nothing real is that quiet.
    powerDbm: direction === "down" && active && power !== null && power > -300 ? power : null,
    powerKw: direction === "up" && active ? power : null,
    spacecraft: craft(config, attrs.spacecraft, attrs.spacecraftID),
  };
}

function targetFrom(config: DsnConfig, raw: z.infer<typeof targetAttrs>): DsnTarget | null {
  const id = Number(raw.id);
  // Id 99 is the network's name for "no spacecraft" (maintenance, engineering).
  if (!Number.isFinite(id) || id === 99) return null;
  const down = toNum(raw.downlegRange);
  const up = toNum(raw.uplegRange);
  const range = down !== null && down > 0 ? down : up !== null && up > 0 ? up : null;
  return { spacecraft: craft(config, raw.name, String(-Math.abs(id))), rangeKm: range };
}

function dishFrom(config: DsnConfig, raw: RawDish): DsnDish {
  const signals = raw.signals.map((s) => signalFrom(config, s));
  const wind = toNum(raw.attrs.windSpeed);
  return {
    id: raw.attrs.name,
    name: raw.attrs.name.replace(/^([A-Za-z]+)(\d+)$/, "$1 $2"),
    sizeM: config.dishSizeM.get(raw.attrs.name) ?? 34,
    azimuthDeg: toNum(raw.attrs.azimuthAngle) ?? 0,
    elevationDeg: toNum(raw.attrs.elevationAngle) ?? 90,
    windKmh: wind,
    activity: raw.attrs.activity,
    array: raw.attrs.isArray === "true",
    targets: raw.targets.map((t) => targetFrom(config, t)).filter((t): t is DsnTarget => t !== null),
    signals,
    onAir: signals.some((s) => s.active),
  };
}

const byRate = (a: DsnSignal, b: DsnSignal): number => (b.rateBps ?? 0) - (a.rateBps ?? 0);

function linksOf(complex: DsnComplex, earthKm: EarthDistance): DsnLink[] {
  const byCraft = new Map<number, DsnLink & { rangesKm: number[] }>();
  for (const dish of complex.dishes) {
    for (const signal of dish.signals) {
      if (!signal.active) continue;
      const id = signal.spacecraft.naifId;
      let link = byCraft.get(id);
      if (!link) {
        link = {
          key: `${complex.id}:${id}`,
          complexId: complex.id,
          spacecraft: signal.spacecraft,
          dishIds: [],
          downlinks: [],
          uplinks: [],
          distanceKm: null,
          distanceSource: null,
          lightSeconds: null,
          rangesKm: [],
        };
        byCraft.set(id, link);
      }
      if (!link.dishIds.includes(dish.id)) link.dishIds.push(dish.id);
      (signal.direction === "down" ? link.downlinks : link.uplinks).push(signal);
      for (const t of dish.targets) if (t.spacecraft.naifId === id && t.rangeKm !== null) link.rangesKm.push(t.rangeKm);
    }
  }
  return [...byCraft.values()].map(({ rangesKm, ...link }) => {
    const horizons = earthKm(link.spacecraft.naifId);
    const dsn = rangesKm.length ? Math.max(...rangesKm) : null;
    const distanceKm = horizons ?? dsn;
    return {
      ...link,
      downlinks: link.downlinks.sort(byRate),
      uplinks: link.uplinks.sort(byRate),
      distanceKm,
      distanceSource: horizons !== null ? "horizons" : dsn !== null ? "dsn" : null,
      lightSeconds: distanceKm === null ? null : lightSecondsOver(distanceKm),
    };
  });
}

export function buildSnapshot(raw: RawReading, config: DsnConfig, earthKm: EarthDistance, fetchedAt: number): DsnSnapshot {
  const complexes: DsnComplex[] = [];
  for (const station of raw.stations) {
    const id = station.attrs.name;
    const site = config.sites.get(id);
    if (!isComplexId(id) || !site) continue;
    complexes.push({
      id,
      name: site.name,
      latitude: site.latitude,
      longitude: site.longitude,
      utcOffsetMin: Math.round((toNum(station.attrs.timeZoneOffset) ?? 0) / 60_000),
      dishes: station.dishes.map((d) => dishFrom(config, d)),
    });
  }
  complexes.sort((a, b) => COMPLEX_ORDER.indexOf(a.id) - COMPLEX_ORDER.indexOf(b.id));
  const links = complexes.flatMap((c) => linksOf(c, earthKm));
  const readingAt = raw.readingAt ?? toNum(raw.stations[0]?.attrs.timeUTC) ?? fetchedAt;
  return { readingAt, fetchedAt, complexes, links };
}

// ── Fetching ──────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetchUpstream(SOURCE, url, { headers: { accept: "application/xml, text/xml, */*" } });
  return res.text();
}

// The disk cache holds each Map as a list of [key, value] pairs.
const StoredConfig = z.object({
  sites: z.array(z.tuple([z.string(), z.object({ name: z.string(), latitude: z.number(), longitude: z.number() })])),
  dishSizeM: z.array(z.tuple([z.string(), z.union([z.literal(70), z.literal(34)])])),
  names: z.array(z.tuple([z.string(), z.string()])),
});

export const loadConfig = (): Promise<DsnConfig> =>
  diskMemo("deepspace-dsn-config", CONFIG_TTL_MS, async () => {
    const config = parseConfig(await fetchText(CONFIG_URL));
    // Maps do not survive JSON, which is how the disk cache stores values.
    return { sites: [...config.sites], dishSizeM: [...config.dishSizeM], names: [...config.names] };
  }, StoredConfig).then((stored) => ({ sites: new Map(stored.sites), dishSizeM: new Map(stored.dishSizeM), names: new Map(stored.names) }));

/** One reading of the network, shared for 10 s between every caller. Distances are filled in per call. */
export const loadReading = (): Promise<{ raw: RawReading; fetchedAt: number }> =>
  memo("deepspace:dsn", READING_TTL_MS, async () => ({ raw: parseReading(await fetchText(DSN_URL)), fetchedAt: Date.now() }), 5 * 60_000);

export async function loadDsn(earthKm: EarthDistance): Promise<DsnSnapshot> {
  const [{ raw, fetchedAt }, config] = await Promise.all([loadReading(), loadConfig()]);
  return buildSnapshot(raw, config, earthKm, fetchedAt);
}
