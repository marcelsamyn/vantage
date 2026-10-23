import { inflateRawSync } from "node:zlib";
import { HttpError, diskMemo, fetchUpstream, memo, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import type { MatrixDisplay, MatrixFeed, MatrixGantry } from "./types";

/**
 * The lane signs above Dutch motorways. NDW publishes what each one shows (CC0, refreshed about every five minutes)
 * and, separately, where each one hangs as a shapefile. The two are joined on the sign's UUID.
 */

const SOURCE = "NDW matrix signs";
const STATE_URL = "https://opendata.ndw.nu/Matrixsignaalinformatie.xml.gz";
const PLACES_URL = "https://opendata.ndw.nu/ndw_msi_shapefiles_latest.zip";
const MAX_GANTRIES = 400;

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

// ── Where signs hang ──────────────────────────────────────────────

/** One file from a zip archive, read through its central directory. */
function unzipEntry(zip: Uint8Array, wanted: string): Uint8Array {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = zip.length - 22;
  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new HttpError(502, "upstream_shape", `${SOURCE} sent a zip file without a directory`);
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (name.endsWith(wanted)) {
      const dataStart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const data = zip.subarray(dataStart, dataStart + size);
      return method === 0 ? data : inflateRawSync(data);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new HttpError(502, "upstream_shape", `${SOURCE} zip has no ${wanted}`);
}

interface Place {
  id: string;
  lat: number;
  lon: number;
}

/** Points from the shapefile, matched row for row with the dBASE table that names each one. */
function readPlaces(shp: Uint8Array, dbf: Uint8Array): Place[] {
  const t = new DataView(dbf.buffer, dbf.byteOffset, dbf.byteLength);
  const rows = t.getUint32(4, true);
  const headerLen = t.getUint16(8, true);
  const recordLen = t.getUint16(10, true);
  let offset = 1;
  let uuid: { at: number; len: number } | null = null;
  for (let f = 32; dbf[f] !== 0x0d && f < headerLen; f += 32) {
    const name = new TextDecoder().decode(dbf.subarray(f, f + 11)).replace(/\0.*$/, "");
    const len = dbf[f + 16] ?? 0;
    if (name === "uuid") uuid = { at: offset, len };
    offset += len;
  }
  if (!uuid) throw new HttpError(502, "upstream_shape", `${SOURCE} shapefile has no uuid column`);

  const s = new DataView(shp.buffer, shp.byteOffset, shp.byteLength);
  const places: Place[] = [];
  let p = 100;
  for (let i = 0; i < rows && p + 28 <= shp.length; i++) {
    const contentWords = s.getInt32(p + 4, false);
    const shapeType = s.getInt32(p + 8, true);
    if (shapeType === 1) {
      const rec = headerLen + i * recordLen + uuid.at;
      const id = new TextDecoder().decode(dbf.subarray(rec, rec + uuid.len)).trim();
      places.push({ id, lon: s.getFloat64(p + 12, true), lat: s.getFloat64(p + 20, true) });
    }
    p += 8 + contentWords * 2;
  }
  return places;
}

const StoredPlaces = z.array(z.object({ id: z.string(), lat: z.number(), lon: z.number() }));

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

function places(): Promise<Map<string, Place>> {
  return diskMemo("pulse-ndw-msi-places", 7 * 24 * 3_600_000, async () => {
    const res = await fetchUpstream(SOURCE, PLACES_URL, { timeoutMs: 30_000, headers: { accept: "application/zip, */*" } });
    const zip = new Uint8Array(await res.arrayBuffer());
    const list = readPlaces(unzipEntry(zip, "shapes.shp"), unzipEntry(zip, "shapes.dbf"));
    return list.map((p) => ({ ...p, lat: r6(p.lat), lon: r6(p.lon) }));
  }, StoredPlaces).then((list) => new Map(list.map((p) => [p.id, p])));
}

// ── What signs show ───────────────────────────────────────────────

interface State {
  display: MatrixDisplay | null;
  since: number;
}

interface Where {
  road: string;
  lane: number;
  km: number;
}

const field = (block: string, tag: string): string | undefined => block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1];

function displayOf(block: string): MatrixDisplay | null {
  const d = block.match(/<display>(.*?)<\/display>/s)?.[1];
  if (!d || d.startsWith("<blank")) return null;
  const flashing = /flashing="true"/.test(d);
  const speed = /<speedlimit[^>]*red_ring="(true|false)"[^>]*>(\d+)<\/speedlimit>/.exec(d);
  if (speed) return { kind: "speed", value: Number(speed[2]), flashing, enforced: speed[1] === "true" };
  if (d.startsWith("<lane_closed_ahead")) return { kind: "ahead", direction: d.includes("<merge_left") ? "left" : "right", flashing };
  if (d.startsWith("<lane_closed")) return { kind: "closed", flashing };
  if (d.startsWith("<lane_open")) return { kind: "open", flashing };
  if (d.startsWith("<restriction_end")) return { kind: "end", flashing };
  return { kind: "other", label: d.match(/^<(\w+)/)?.[1]?.replace(/_/g, " ") ?? "sign", flashing };
}

async function loadStates(): Promise<{ states: Map<string, State>; where: Map<string, Where> }> {
  const res = await fetchUpstream(SOURCE, STATE_URL, { timeoutMs: 30_000, headers: { accept: "application/xml, */*" } });
  const bytes = new Uint8Array(await res.arrayBuffer());
  const xml = new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? Bun.gunzipSync(bytes) : bytes);
  const states = new Map<string, State>();
  const where = new Map<string, Where>();
  for (const m of xml.matchAll(/<event>(.*?)<\/event>/gs)) {
    const block = m[1] ?? "";
    const id = field(block, "uuid");
    if (!id) continue;
    if (block.includes("<lanelocation>")) {
      const road = field(block, "road");
      const lane = Number(field(block, "lane"));
      const km = Number(field(block, "km"));
      if (road && Number.isFinite(lane) && Number.isFinite(km)) where.set(id, { road, lane, km });
      continue;
    }
    const since = Date.parse(field(block, "ts_state") ?? "");
    const prev = states.get(id);
    if (Number.isFinite(since) && (!prev || since >= prev.since)) states.set(id, { display: displayOf(block), since });
  }
  if (states.size === 0) throw new HttpError(502, "upstream_shape", `${SOURCE} sent no sign states`);
  return { states, where };
}

/** Gantries inside the bounds with at least one lane sign showing something. Blank signs are most of them and are left out. */
export async function matrixSigns(b: Bounds): Promise<MatrixFeed> {
  const [placed, live] = await Promise.all([places(), memo("pulse:msi:states", 120_000, loadStates, 3_600_000)]);
  const byGantry = new Map<string, MatrixGantry>();
  for (const [id, s] of live.states) {
    if (!s.display) continue;
    const place = placed.get(id);
    const loc = live.where.get(id);
    if (!place || !loc || place.lon < b.west || place.lon > b.east || place.lat < b.south || place.lat > b.north) continue;
    // The signs of one gantry share a position and a kilometre post.
    const key = `${loc.road}:${loc.km}:${place.lat}:${place.lon}`;
    const gantry = byGantry.get(key) ?? { id: key, road: loc.road, km: loc.km, lat: place.lat, lon: place.lon, lanes: [] };
    gantry.lanes.push({ lane: loc.lane, display: s.display, since: s.since });
    byGantry.set(key, gantry);
  }
  const all = [...byGantry.values()].map((g) => ({ ...g, lanes: g.lanes.sort((x, y) => x.lane - y.lane) }));
  if (all.length <= MAX_GANTRIES) return { gantries: all, total: all.length, capped: false };
  const centre = { lat: (b.south + b.north) / 2, lon: (b.west + b.east) / 2 };
  return { gantries: all.sort((x, y) => distanceM(centre, x) - distanceM(centre, y)).slice(0, MAX_GANTRIES), total: all.length, capped: true };
}
