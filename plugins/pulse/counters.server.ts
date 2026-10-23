import { HttpError, diskMemo, fetchJson, log, memo, z } from "../../server/kit";
import { dayKey, zoned } from "./time.server";
import type { Counter, CounterDetail, CounterSeries } from "./types";

/**
 * Bicycle counters. Brussels Mobility publishes 18 counters that update whenever a bicycle passes (CC BY 4.0).
 * Ghent publishes its counter posts as monthly datasets, so they show the latest published day, not the last hour.
 * Both count passages only: no vehicle, person or number plate is identified.
 */

const HOUR_MS = 3_600_000;

/** "Published counts, 24 h to Tue 6 Oct, 22:00": the published series ends days before today, so it says when. */
function seriesLabel(bins: readonly { at: number }[]): string {
  const end = (bins[bins.length - 1]?.at ?? 0) + HOUR_MS;
  const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(end);
  return `Published counts, 24 h to ${when}`;
}


// ── Brussels ──────────────────────────────────────────────────────

const BRUSSELS = "https://data.mobility.brussels/bike/api/counts/";
const BRUSSELS_TZ = "Europe/Brussels";
/** A counter silent for longer than this has been switched off, not merely quiet. */
const STALE_MS = 30 * 24 * HOUR_MS;

const Devices = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }),
      properties: z.object({ device_name: z.string(), active: z.boolean().nullish(), road_en: z.string().nullish(), descr_en: z.string().nullish() }),
    }),
  ),
});
const Live = z.object({ data: z.record(z.string(), z.object({ hour_cnt: z.number().nullish(), day_cnt: z.number().nullish(), cnt_time: z.string().nullish() })) });

const StoredDevices = z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number() }));

function brusselsDevices(): Promise<{ id: string; name: string; lat: number; lon: number }[]> {
  return diskMemo("pulse-brussels-counters", 24 * HOUR_MS, async () => {
    const data = await fetchJson("Brussels bike counters", `${BRUSSELS}?request=devices`, Devices);
    return data.features
      .filter((f) => f.properties.active !== false)
      .map((f) => ({ id: f.properties.device_name, name: f.properties.road_en ?? f.properties.descr_en ?? f.properties.device_name, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }));
  }, StoredDevices);
}

async function brussels(): Promise<Counter[]> {
  const [devices, live] = await Promise.all([brusselsDevices(), memo("pulse:brussels:live", 60_000, () => fetchJson("Brussels bike counters", `${BRUSSELS}?request=live`, Live))]);
  const now = Date.now();
  const today = dayKey(now, BRUSSELS_TZ);
  const out: Counter[] = [];
  for (const d of devices) {
    const l = live.data[d.id];
    if (!l) continue;
    const at = l.cnt_time ? zoned(l.cnt_time, BRUSSELS_TZ) : null;
    if (at === null || now - at > STALE_MS) continue;
    // The source only updates when a bicycle passes. An hour count older than an hour, or a day count from yesterday, has decayed to zero.
    const hour = now - at > HOUR_MS ? 0 : (l.hour_cnt ?? null);
    const day = dayKey(at, BRUSSELS_TZ) === today ? (l.day_cnt ?? null) : 0;
    out.push({ id: `brussels:${d.id}`, name: d.name, city: "Brussels", counts: "cyclists", lat: d.lat, lon: d.lon, hour, day, dayLabel: "today", at, live: true });
  }
  return out;
}

const History = z.object({
  timeGaps: z.array(z.tuple([z.number(), z.string(), z.string()])),
  data: z.array(z.object({ count_date: z.string(), time_gap: z.number(), count: z.number() })),
});

const ymd = (ms: number): string => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** Published counts are in 15-minute bins (UTC) and trail the live figures by a day or two. */
async function brusselsSeries(device: string): Promise<{ series: CounterSeries; label: string }> {
  const now = Date.now();
  const data = await memo(`pulse:brussels:history:${device}`, 30 * 60_000, () => fetchJson("Brussels bike counters", `${BRUSSELS}?request=history&featureID=${encodeURIComponent(device)}&startDate=${ymd(now - 4 * 24 * HOUR_MS)}&endDate=${ymd(now)}`, History));
  const starts = new Map(data.timeGaps.map(([n, from]) => [n, from]));
  const hourly = new Map<number, number>();
  for (const row of data.data) {
    const from = starts.get(row.time_gap);
    if (!from) continue;
    const t = Date.parse(`${row.count_date.replaceAll("/", "-")}T${from}Z`);
    if (!Number.isFinite(t)) continue;
    const hour = Math.floor(t / HOUR_MS) * HOUR_MS;
    hourly.set(hour, (hourly.get(hour) ?? 0) + row.count);
  }
  const bins = [...hourly].sort((a, b) => a[0] - b[0]).map(([at, count]) => ({ at, count }));
  const last24 = bins.slice(-24);
  if (last24.length === 0) throw new HttpError(404, "no_history", `Brussels Mobility has published no counts for ${device} in the last four days`);
  return { series: { bins: last24, binMinutes: 60 }, label: seriesLabel(last24) };
}

// ── Ghent ─────────────────────────────────────────────────────────

const GHENT = "https://data.stad.gent/api/explore/v2.1/catalog/datasets";
const GHENT_TZ = "Europe/Brussels";

const GhentPosts = z.object({
  results: z.array(z.object({ naam: z.string(), code: z.string(), geometry: z.object({ geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]).rest(z.number()) }) }) })),
});
const GhentBins = z.array(z.object({ ordening: z.iso.datetime({ offset: true }), totaal: z.string() }));

/** Dataset names are the post's name, lower-cased with dashes; a few differ. */
const GHENT_ALIAS: Record<string, string> = { "spoorwegbrug-drongen": "drongen-spoorwegbrug" };
const slug = (s: string): string => {
  const plain = s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return GHENT_ALIAS[plain] ?? plain;
};

const GhentCount = z.object({ total_count: z.number() });

interface GhentPost {
  id: string;
  name: string;
  /** The dataset that holds this post's counts. */
  dataset: string;
  lat: number;
  lon: number;
}

const StoredPosts = z.array(z.object({ id: z.string(), name: z.string(), dataset: z.string(), lat: z.number(), lon: z.number() }));

/** The counter posts that have a dataset: this year's, or last year's while this year's has not started. */
function ghentPosts(): Promise<GhentPost[]> {
  return diskMemo("pulse-ghent-counter-posts", 24 * HOUR_MS, async () => {
    const list = await fetchJson("Ghent bike counters", `${GHENT}/fietstelpalen-gent/records?limit=50`, GhentPosts);
    const year = new Date().getFullYear();
    const posts = await Promise.all(
      list.results.map(async (r): Promise<GhentPost | null> => {
        for (const y of [year, year - 1]) {
          const dataset = `fietstelpaal-${slug(r.naam)}-${y}-gent`;
          const found = await fetchJson("Ghent bike counters", `${GHENT}/${dataset}/records?limit=1`, GhentCount).catch(() => null);
          if (found && found.total_count > 0) return { id: r.code, name: r.naam, dataset, lon: r.geometry.geometry.coordinates[0], lat: r.geometry.geometry.coordinates[1] };
        }
        return null;
      }),
    );
    return posts.filter((p): p is GhentPost => p !== null);
  }, StoredPosts);
}

const StoredBins = z.array(z.object({ at: z.number(), count: z.number() }));

interface GhentBin {
  at: number;
  count: number;
}

/** The newest published bins of one post, oldest first. The city appends a month at a time, so a few hours of caching loses nothing. */
export function ghentBins(post: GhentPost): Promise<GhentBin[]> {
  return diskMemo(`pulse-ghent-bins-${post.id}`, 4 * HOUR_MS, async () => {
    const url = `${GHENT}/${post.dataset}/exports/json?select=ordening,totaal&order_by=ordening%20desc&limit=700`;
    const rows = await fetchJson("Ghent bike counters", url, GhentBins, { timeoutMs: 20_000 });
    return rows
      .map((r) => ({ at: Date.parse(r.ordening), count: Number(r.totaal) || 0 }))
      .sort((a, b) => a.at - b.at);
  }, StoredBins);
}

async function ghent(): Promise<Counter[]> {
  const posts = await ghentPosts();
  const settled = await Promise.allSettled(posts.map((p) => ghentBins(p)));
  const out: Counter[] = [];
  settled.forEach((r, i) => {
    const post = posts[i];
    if (!post) return;
    if (r.status === "rejected") {
      log.warn("ghent counter unavailable", { post: post.name, error: r.reason instanceof Error ? r.reason.message : String(r.reason) });
      return;
    }
    const last = r.value[r.value.length - 1];
    if (!last) return;
    const lastDay = dayKey(last.at, GHENT_TZ);
    const day = r.value.filter((b) => dayKey(b.at, GHENT_TZ) === lastDay).reduce((sum, b) => sum + b.count, 0);
    out.push({ id: `ghent:${post.id}`, name: post.name, city: "Ghent", counts: "cyclists", lat: post.lat, lon: post.lon, hour: null, day, dayLabel: "latest published day", at: last.at, live: false });
  });
  return out;
}

async function ghentSeries(code: string): Promise<{ series: CounterSeries; label: string }> {
  const post = (await ghentPosts()).find((p) => p.id === code);
  if (!post) throw new HttpError(404, "unknown_counter", `Ghent has no counter post ${code}`);
  const bins = await ghentBins(post);
  const last = bins[bins.length - 1];
  if (!last) throw new HttpError(404, "no_history", `Ghent has published no counts for ${post.name}`);
  const hourly = new Map<number, number>();
  for (const b of bins) {
    if (b.at <= last.at - 24 * HOUR_MS) continue;
    const hour = Math.floor(b.at / HOUR_MS) * HOUR_MS;
    hourly.set(hour, (hourly.get(hour) ?? 0) + b.count);
  }
  const series = [...hourly].sort((a, b) => a[0] - b[0]).map(([at, count]) => ({ at, count }));
  return { series: { bins: series, binMinutes: 60 }, label: seriesLabel(series) };
}

// ── Public ────────────────────────────────────────────────────────

export function counters(): Promise<Counter[]> {
  return memo("pulse:counters", 60_000, async () => {
    const settled = await Promise.allSettled([brussels(), ghent()]);
    const out: Counter[] = [];
    const errors: string[] = [];
    for (const r of settled) {
      if (r.status === "fulfilled") out.push(...r.value);
      else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
    }
    if (out.length === 0) throw new HttpError(502, "upstream_unreachable", `No bicycle counter feed answered. ${errors.join("; ")}`);
    return out;
  });
}

export async function counterDetail(id: string): Promise<CounterDetail> {
  const [city, code] = id.split(":");
  if (!code) throw new HttpError(400, "bad_counter", "Counter ids look like brussels:CB1101");
  const { series, label } = city === "brussels" ? await brusselsSeries(code) : city === "ghent" ? await ghentSeries(code) : await Promise.reject(new HttpError(404, "unknown_counter", `No counters in "${city}"`));
  return { id, series, label };
}
