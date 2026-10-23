import { localEnabled } from "../scripts/registry";
import type { HealthReport, ProbeResult } from "../shared/health";
import type { IpLocation, Place } from "../shared/location";
import { defineSource, fetchJson, geocode, json, lat, lon, memo, parseQuery, reverseGeocode, z, type Probe, type Source } from "./kit";

/**
 * Kernel API, mounted at /api/core. Location lookups live here because the shell needs them
 * before any plugin loads; health aggregates the probes every plugin declares.
 */

// ── IP location (ipwho.is) ────────────────────────────────────────

const IpWho = z.object({
  ip: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  city: z.string().default(""),
  region: z.string().default(""),
  country: z.string().default(""),
  country_code: z.string().default(""),
  connection: z.object({ asn: z.number().nullable().optional(), isp: z.string().optional(), org: z.string().optional() }).optional(),
  timezone: z.object({ id: z.string() }).optional(),
});

// ── Health ────────────────────────────────────────────────────────

const STARTED_AT = new Date().toISOString();

async function probe({ name, url }: Probe, plugin: string): Promise<ProbeResult> {
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { "user-agent": "VANTAGE/0.1" } });
    await res.body?.cancel();
    return { plugin, name, ok: res.ok, ms: Math.round(performance.now() - started), detail: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { plugin, name, ok: false, ms: Math.round(performance.now() - started), detail: err instanceof Error ? err.message : String(err) };
  }
}

const CORE_PROBES: Probe[] = [
  { name: "Geocoder · Photon", url: "https://photon.komoot.io/api/?q=a&limit=1" },
  ...(localEnabled() ? [{ name: "IP location · ipwho.is", url: "https://ipwho.is/8.8.8.8" }] : []),
];

/** Built by the server once every plugin is loaded, so health can check every plugin's upstreams. */
export function coreSource(pluginProbes: { plugin: string; probe: Probe }[]): Source {
  const probes = [...CORE_PROBES.map((p) => ({ plugin: "core", probe: p })), ...pluginProbes];
  return defineSource({
    routes: {
      "GET /health": async () => {
        const results = await memo("health", 30_000, () => Promise.all(probes.map((p) => probe(p.probe, p.plugin))));
        return json({ ok: true, ...(localEnabled() ? { startedAt: STARTED_AT } : {}), probes: results } satisfies HealthReport);
      },

      "GET /geocode": async (req) => {
        const q = parseQuery(req, z.object({ q: z.string().trim().min(2).max(200), lat: lat.optional(), lon: lon.optional() }));
        const near = q.lat !== undefined && q.lon !== undefined ? { lat: q.lat, lon: q.lon } : undefined;
        return json((await geocode(q.q, near)) satisfies Place[], { maxAge: 3600 });
      },

      "GET /reverse": async (req) => {
        const q = parseQuery(req, z.object({ lat, lon }));
        return json((await reverseGeocode(q.lat, q.lon)) satisfies Place | null, { maxAge: 86_400 });
      },

      ...(localEnabled() ? { "GET /iploc": async () => {
        const d = await memo("iploc", 600_000, () => fetchJson("ipwho.is", "https://ipwho.is/", IpWho));
        return json({
          ip: d.ip,
          lat: d.latitude,
          lon: d.longitude,
          city: d.city,
          region: d.region,
          country: d.country,
          countryCode: d.country_code,
          isp: d.connection?.isp ?? d.connection?.org ?? "Unknown provider",
          asn: d.connection?.asn ?? null,
          timezone: d.timezone?.id ?? "UTC",
        } satisfies IpLocation);
      } } : {}),
    },
  });
}
