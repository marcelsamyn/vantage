import { inflateSync } from "node:zlib";
import { fetchUpstream, HttpError, memo } from "../../server/kit";
import type { FireSpots, SatelliteFrames } from "./types";

/**
 * EUMETSAT's public EUMETView map service (WMS). The browser never names a URL: it asks for a frame time, and this file
 * checks it against the times the service lists, so only frames the service itself offers can be fetched.
 */

const WMS = "https://view.eumetsat.int/geoserver/ows";

/** Europe from Iberia to the Urals' edge and from the Sahara's rim to Lapland. */
export const BOUNDS = { west: -12, south: 30, east: 40, north: 62 } as const;
const WIDTH = 1536;
/** The service draws each detection as a small square mark whatever the scale; a finer picture places it more exactly. */
const FIRE_WIDTH = 3072;
/** The service allows 20 requests a second and 8 at once per user; two at a time is far below both. */
const MAX_CONCURRENT = 2;
const MAX_IMAGE_BYTES = 2_000_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];

type SatelliteLayer = "lightning" | "fires";

interface Source {
  /** Layer-specific capabilities document: a few KB instead of the 280 KB service-wide one. */
  capabilities: string;
  wmsLayer: string;
}

const SOURCES: Record<SatelliteLayer, Source> = {
  // Meteosat Third Generation Lightning Imager: flashes counted in 5-minute steps.
  lightning: { capabilities: "https://view.eumetsat.int/geoserver/mtg_fd/li_afa/ows?service=WMS&version=1.3.0&request=GetCapabilities", wmsLayer: "mtg_fd:li_afa" },
  // Meteosat Third Generation fire radiative power: one detection per 2 km pixel, every 10 minutes.
  fires: { capabilities: "https://view.eumetsat.int/geoserver/mtg_fd/frp/ows?service=WMS&version=1.3.0&request=GetCapabilities", wmsLayer: "mtg_fd:frp" },
};

/** The loop covers the last hour. */
const LOOP_MIN = 60;

export interface TimeDimension {
  /** The newest frame, ISO 8601 in UTC. */
  latest: string;
  stepMin: number;
}

/** Reads `<Dimension name="time" default="…">first/last/PT5M</Dimension>` from a WMS capabilities document. */
export function parseTimeDimension(xml: string): TimeDimension | null {
  const m = /<Dimension\s+name="time"[^>]*\sdefault="([^"]+)"[^>]*>[^<]*\/PT(\d+)M\s*</.exec(xml);
  const latest = m?.[1];
  const step = Number(m?.[2]);
  if (!latest || !Number.isFinite(step) || step <= 0 || Number.isNaN(Date.parse(latest))) return null;
  return { latest: new Date(latest).toISOString().replace(".000Z", "Z"), stepMin: step };
}

/** The `count` newest frame times, oldest first. */
export function frameTimes({ latest, stepMin }: TimeDimension, count: number): string[] {
  const end = Date.parse(latest);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * stepMin * 60_000).toISOString().replace(".000Z", "Z"));
}

async function dimension(layer: SatelliteLayer): Promise<TimeDimension> {
  return memo(`satellite:dimension:${layer}`, 2 * 60_000, async () => {
    const res = await fetchUpstream("EUMETView", SOURCES[layer].capabilities, { headers: { accept: "text/xml" } });
    const dim = parseTimeDimension(await res.text());
    if (!dim) throw new HttpError(502, "upstream_shape", "EUMETView did not list a time dimension for this layer");
    return dim;
  });
}

export async function lightningFrames(): Promise<SatelliteFrames> {
  const dim = await dimension("lightning");
  return { bounds: BOUNDS, stepMin: dim.stepMin, frames: frameTimes(dim, Math.round(LOOP_MIN / dim.stepMin)) };
}

// Web Mercator metres: the WMS draws the frame in the projection the map uses, so the picture lines up without resampling.
const R = 6_378_137;
const mercatorY = (lat: number): number => R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const mercatorX = (lon: number): number => (lon * Math.PI * R) / 180;
const latFromY = (y: number): number => (Math.atan(Math.exp(y / R)) * 360) / Math.PI - 90;

function imageUrl(layer: SatelliteLayer, t: string, width: number): string {
  const [x0, y0, x1, y1] = [mercatorX(BOUNDS.west), mercatorY(BOUNDS.south), mercatorX(BOUNDS.east), mercatorY(BOUNDS.north)];
  const q = new URLSearchParams({
    service: "WMS",
    version: "1.3.0",
    request: "GetMap",
    layers: SOURCES[layer].wmsLayer,
    styles: "",
    crs: "EPSG:3857",
    bbox: [x0, y0, x1, y1].join(","),
    width: String(width),
    height: String(Math.round((width * (y1 - y0)) / (x1 - x0))),
    format: "image/png",
    transparent: "true",
    time: t,
  });
  return `${WMS}?${q}`;
}

let running = 0;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  while (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await work();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

async function fetchPng(layer: SatelliteLayer, t: string, width: number): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetchUpstream("EUMETView", imageUrl(layer, t, width), { headers: { accept: "image/png" }, timeoutMs: 25_000 });
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(502, "upstream_shape", "EUMETView sent an image larger than expected");
  if (!PNG_MAGIC.every((b, i) => bytes[i] === b)) throw new HttpError(502, "upstream_shape", "EUMETView did not answer with a PNG image (the service may be down for maintenance)");
  return bytes;
}

/** A frame leaves the loop after an hour. Keep it a little longer, and no stale window beyond that, so memory holds about a dozen PNGs and not thirty hours of them. */
export const FRAME_KEPT_MS = (LOOP_MIN + 10) * 60_000;

/** One lightning frame as PNG bytes. A published frame never changes, so it is kept for as long as the loop can ask for it. */
export async function lightningImage(t: string): Promise<Uint8Array<ArrayBuffer>> {
  const { frames } = await lightningFrames();
  if (!frames.includes(t)) throw new HttpError(404, "no_such_frame", `Lightning has no frame for ${t}; ask /api/weather/lightning/frames for the times on offer`);
  return memo(`satellite:image:lightning:${t}`, FRAME_KEPT_MS, () => slot(() => fetchPng("lightning", t, WIDTH)), FRAME_KEPT_MS);
}

// ── Fire detections ───────────────────────────────────────────

export interface Raster {
  width: number;
  height: number;
  /** Alpha of each pixel, row by row. */
  alpha: Uint8Array;
}

/** Reads the alpha channel of an 8-bit RGBA, non-interlaced PNG, which is what GeoServer draws for a transparent map. */
export function pngAlpha(png: Uint8Array): Raster {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0;
  let height = 0;
  const parts: Uint8Array[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (body[8] !== 8 || body[9] !== 6 || body[12] !== 0) throw new HttpError(502, "upstream_shape", "EUMETView sent a PNG in a format this app does not read (expected 8-bit RGBA)");
    } else if (type === "IDAT") parts.push(body);
    else if (type === "IEND") break;
    at += 12 + length;
  }
  const packed = new Uint8Array(parts.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of parts) {
    packed.set(c, offset);
    offset += c.length;
  }
  const raw = inflateSync(packed);
  const stride = width * 4;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)] ?? 0;
    const line = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? (rows[y * stride + x - 4] ?? 0) : 0;
      const up = y > 0 ? (rows[(y - 1) * stride + x] ?? 0) : 0;
      const upLeft = y > 0 && x >= 4 ? (rows[(y - 1) * stride + x - 4] ?? 0) : 0;
      let predictor: number;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = (left + up) >> 1;
          break;
        case 4: {
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          break;
        }
        default:
          throw new HttpError(502, "upstream_shape", "EUMETView sent a PNG with an unknown row filter");
      }
      rows[y * stride + x] = ((raw[line + x] ?? 0) + predictor) & 0xff;
    }
  }
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = rows[i * 4 + 3] ?? 0;
  return { width, height, alpha };
}

/** Joins touching marks into one detection each, placed at the middle of the mark. */
export function spotsIn({ width, height, alpha }: Raster): FireSpots["spots"] {
  const yTop = mercatorY(BOUNDS.north);
  const yBottom = mercatorY(BOUNDS.south);
  const seen = new Uint8Array(alpha.length);
  const spots: FireSpots["spots"] = [];
  for (let start = 0; start < alpha.length; start++) {
    if (!alpha[start] || seen[start]) continue;
    let sumX = 0;
    let sumY = 0;
    let n = 0;
    const stack = [start];
    seen[start] = 1;
    for (let at = stack.pop(); at !== undefined; at = stack.pop()) {
      const x = at % width;
      const y = (at - x) / width;
      sumX += x + 0.5;
      sumY += y + 0.5;
      n++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          const next = ny * width + nx;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || seen[next] || !alpha[next]) continue;
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    const lon = BOUNDS.west + (sumX / n / width) * (BOUNDS.east - BOUNDS.west);
    const lat = latFromY(yTop - (sumY / n / height) * (yTop - yBottom));
    spots.push({ lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000 });
  }
  return spots;
}

/** Where Meteosat sees fire right now, from the newest frame of EUMETView's fire radiative power layer. */
export async function fireSpots(): Promise<FireSpots> {
  const dim = await dimension("fires");
  return memo(`satellite:fires:${dim.latest}`, 3 * 3_600_000, () =>
    slot(async () => ({ time: dim.latest, stepMin: dim.stepMin, spots: spotsIn(pngAlpha(await fetchPng("fires", dim.latest, FIRE_WIDTH))) })),
  );
}
