import { defineSource, diskMemo, fetchJson, json, memo, parseQuery, z } from "../../server/kit";
import { fetchCuts } from "./cuts.server";
import { fetchBelgium, fetchLineMap } from "./elia.server";
import { detectDips } from "./frequency.server";
import { buildGasFlows, fetchGasRows } from "./gas.server";
import { buildMix } from "./mix.server";
import { buildFleet, fetchNuclearInput } from "./nuclear.server";
import { COUNTRY_CODES, ZONES, type FrequencyData, type FrequencyDip, type GreenSignal, type PricePoints } from "./types";

/**
 * European grid data. Energy-Charts (Fraunhofer ISE, CC BY 4.0) supplies frequency, generation, prices
 * and the green/red signal. It allows two requests a minute per endpoint, so every route caches.
 * Belgium's border flows come from Elia Open Data.
 */

const EC = "https://api.energy-charts.info";
const FREQUENCY_REGION = "DE-Freiburg";

// ── Frequency ─────────────────────────────────────────────────────

const FrequencyReply = z.object({ unix_seconds: z.array(z.number()), data: z.array(z.number().nullable()) });

/** Three hours of one-second readings, enough to find dips and to refill the screen after a reload. */
const RETAIN_S = 3 * 3600;
/** The source answers about two minutes behind; a refresh every 40 s stays inside its rate limit. */
const REFRESH_MS = 40_000;

const store: { t: number[]; hz: number[]; dips: FrequencyDip[] } = { t: [], hz: [], dips: [] };

async function refreshFrequency(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const last = store.t.at(-1);
  if (last !== undefined && last < now - RETAIN_S) {
    store.t = [];
    store.hz = [];
  }
  const newest = store.t.at(-1);
  const start = newest === undefined ? now - RETAIN_S : newest + 1;
  const reply = await fetchJson("Energy-Charts frequency", `${EC}/frequency?region=${FREQUENCY_REGION}&start=${start}&end=${now}`, FrequencyReply, { timeoutMs: 25_000 });
  reply.unix_seconds.forEach((t, i) => {
    const hz = reply.data[i];
    if (hz === null || hz === undefined || t <= (store.t.at(-1) ?? 0)) return;
    store.t.push(t);
    store.hz.push(hz);
  });
  const cut = store.t.findIndex((t) => t >= now - RETAIN_S);
  if (cut > 0) {
    store.t.splice(0, cut);
    store.hz.splice(0, cut);
  }
  store.dips = detectDips(store.t, store.hz);
}

// ── Mix, price, signal ────────────────────────────────────────────

const Country = z.enum(COUNTRY_CODES);

const MixReply = z.object({
  unix_seconds: z.array(z.number()),
  production_types: z.array(z.object({ name: z.string(), data: z.array(z.number().nullable()) })),
});

const PriceReply = z.object({ license_info: z.string(), unix_seconds: z.array(z.number()), price: z.array(z.number().nullable()), unit: z.string() });

const SignalReply = z.object({ unix_seconds: z.array(z.number()), share: z.array(z.number().nullable()), signal: z.array(z.number().nullable()), substitute: z.boolean() });

const Zone = z.enum(ZONES);

const StoredPrice = z.object({ zone: Zone, unit: z.string(), t: z.array(z.number()), eurMwh: z.array(z.number()), licence: z.string() });

const StoredSignal = z.object({ country: Country, t: z.array(z.number()), share: z.array(z.number()), signal: z.array(z.number()), substitute: z.boolean() });

const Coords = z.array(z.tuple([z.number(), z.number()]));

const StoredLineMap = z.object({
  at: z.number(),
  internal: z.array(z.object({ id: z.string(), name: z.string(), loading: z.number().nullable(), coords: Coords })),
  ties: z.array(z.object({ id: z.string(), name: z.string(), border: z.enum(["France", "Germany", "Netherlands", "Luxembourg", "United Kingdom"]), loading: z.number().nullable(), coords: Coords })),
});

/** Today and tomorrow as calendar dates in Rome and Brussels (one shared time zone), the way Energy-Charts reads whole days. */
function localDates(): { today: string; tomorrow: string } {
  const fmt = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
  const now = Date.now();
  return { today: fmt.format(now), tomorrow: fmt.format(now + 86_400_000) };
}

const HOUR_MS = 3_600_000;

export default defineSource({
  probes: [
    // The API root answers without spending the rate-limited data endpoints' quota.
    { name: "Grid data · Energy-Charts", url: `${EC}/` },
    { name: "Belgian grid · Elia Open Data", url: "https://opendata.elia.be/api/explore/v2.1/catalog/datasets/ods169/records?limit=1" },
    { name: "Gas flows · ENTSOG", url: "https://transparency.entsog.eu/api/v1/balancingZones?limit=1" },
    { name: "Power cuts · Amsterdam open data", url: "https://api.data.amsterdam.nl/v1/stroomstoringen/" },
  ],
  routes: {
    "GET /frequency": async (req) => {
      const q = parseQuery(req, z.object({ since: z.coerce.number().int().optional(), window: z.coerce.number().int().min(60).max(RETAIN_S).default(3600) }));
      await memo("power:frequency", REFRESH_MS, async () => {
        await refreshFrequency();
        return true;
      });
      const newest = store.t.at(-1) ?? 0;
      const from = q.since ?? newest - q.window;
      const first = store.t.findIndex((t) => t > from);
      const start = first === -1 ? store.t.length : first;
      return json({ t: store.t.slice(start), hz: store.hz.slice(start), dips: store.dips, lagS: Math.max(0, Math.floor(Date.now() / 1000) - newest) } satisfies FrequencyData);
    },

    "GET /mix": async (req) => {
      const { country } = parseQuery(req, z.object({ country: Country }));
      // Cache the source's reply, not the derived mix, so a change to how the mix is computed applies at once.
      const reply = await diskMemo(`power-generation-${country}`, 10 * 60_000, () => {
        const now = Math.floor(Date.now() / 1000);
        return fetchJson("Energy-Charts generation", `${EC}/public_power?country=${country}&start=${now - 26 * 3600}&end=${now}`, MixReply);
      }, MixReply);
      return json(buildMix(country, reply.unix_seconds, reply.production_types), { maxAge: 120 });
    },

    "GET /price": async (req) => {
      const { zone } = parseQuery(req, z.object({ zone: Zone }));
      const { today, tomorrow } = localDates();
      const price = await diskMemo(`power-price-${zone}-${today}`, 30 * 60_000, async (): Promise<PricePoints> => {
        const reply = await fetchJson("Energy-Charts day-ahead price", `${EC}/price?bzn=${zone}&start=${today}&end=${tomorrow}`, PriceReply);
        const t: number[] = [];
        const eurMwh: number[] = [];
        reply.unix_seconds.forEach((s, i) => {
          const p = reply.price[i];
          if (p === null || p === undefined) return;
          t.push(s);
          eurMwh.push(p);
        });
        // Zones under CC BY carry the licence name; the rest say they are for private use only.
        const licence = reply.license_info.startsWith("CC BY") ? "CC BY 4.0, Bundesnetzagentur | SMARD.de" : "Private and internal use only (EPEX SPOT)";
        return { zone, unit: reply.unit, t, eurMwh, licence };
      }, StoredPrice);
      return json(price, { maxAge: 300 });
    },

    "GET /signal": async (req) => {
      const { country } = parseQuery(req, z.object({ country: Country }));
      const signal = await diskMemo(`power-signal-${country}`, 10 * 60_000, async (): Promise<GreenSignal> => {
        const reply = await fetchJson("Energy-Charts green signal", `${EC}/signal?country=${country}`, SignalReply);
        const t: number[] = [];
        const share: number[] = [];
        const level: number[] = [];
        reply.unix_seconds.forEach((s, i) => {
          const sh = reply.share[i];
          const sg = reply.signal[i];
          if (sh === null || sh === undefined || sg === null || sg === undefined) return;
          t.push(s);
          share.push(sh);
          level.push(sg);
        });
        return { country, t, share, signal: level, substitute: reply.substitute };
      }, StoredSignal);
      return json(signal, { maxAge: 300 });
    },

    "GET /belgium": async () => json(await memo("power:belgium", 90_000, fetchBelgium), { maxAge: 60 }),

    "GET /lines": async () => json(await diskMemo("power-lines", 12 * HOUR_MS, fetchLineMap, StoredLineMap), { maxAge: 3600 }),

    // The raw rows are cached and the fleet is derived on each request, so a change to the derivation applies at once.
    "GET /nuclear": async () => json(buildFleet(await memo("power:nuclear", 5 * 60_000, fetchNuclearInput)), { maxAge: 120 }),

    // ENTSOG publishes each hour about two hours late, so a ten-minute cache loses nothing.
    "GET /gas": async () => json(buildGasFlows(await memo("power:gas", 10 * 60_000, fetchGasRows)), { maxAge: 300 }),

    "GET /cuts": async () => json(await memo("power:cuts", 60_000, fetchCuts), { maxAge: 30 }),
  },
});
