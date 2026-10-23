import { describe, expect, test } from "bun:test";
import { HttpError } from "../../server/kit";
import { BANDS, bandReach, cosmicRaysFrom, fieldFrom, fieldLevel, ionosphereFrom, loadField, maxHopKm, parseNmdb, type BgsRaw, type SoundingRaw } from "./shields.server";

// Recorded replies, kept as received: NMDB's ascii tables (hourly counts, 7 days), BGS minute data thinned to every
// fifth minute, and a handful of the stations KC2G listed at 00:15-00:25 UTC on 2026-10-09.
const fixture = (name: string): Promise<string> => Bun.file(`${import.meta.dir}/fixtures/${name}`).text();

describe("NMDB parsing", () => {
  test("reads both monitors and skips hours that arrive as null", async () => {
    const rows = parseNmdb(await fixture("nmdb-2025-11-forbush.txt"));
    expect([...rows.keys()]).toEqual(["ROME", "DRBS"]);
    expect(rows.get("ROME")).toHaveLength(168);
    expect(rows.get("DRBS")).toHaveLength(162);
    expect(rows.get("ROME")?.[0]).toEqual({ at: Date.parse("2025-11-08T00:00:00Z"), cps: 111.297 });
  });

  test("a reply without a station header is refused", () => {
    expect(() => parseNmdb("# nothing here\n")).toThrow(/no station header/);
  });
});

describe("Forbush decreases in recorded weeks", () => {
  test("May 2024, the strongest storm in two decades, is found at Dourbes and confirmed by Rome", async () => {
    const { forbush } = cosmicRaysFrom(await fixture("nmdb-2024-05-forbush.txt"));
    expect(forbush?.code).toBe("DRBS");
    expect(forbush?.depthPct).toBeGreaterThan(9);
    expect(new Date(forbush?.onsetAt ?? 0).toISOString().slice(0, 10)).toBe("2024-05-10");
    expect(forbush?.ongoing).toBe(true);
  });

  test("November 2025 is found", async () => {
    const { forbush } = cosmicRaysFrom(await fixture("nmdb-2025-11-forbush.txt"));
    expect(forbush?.depthPct).toBeGreaterThan(10);
    expect(new Date(forbush?.onsetAt ?? 0).toISOString().slice(0, 10)).toBe("2025-11-11");
  });

  test("the event shows up within hours of its start, before the recovery is known", async () => {
    const text = await fixture("nmdb-2024-05-forbush.txt");
    const cut = text
      .split("\n")
      .filter((l) => !/^2024-05-1[1-4]/.test(l))
      .join("\n");
    const { forbush } = cosmicRaysFrom(cut);
    expect(forbush).not.toBeNull();
    expect(forbush?.ongoing).toBe(true);
  });

  test("quiet weeks, with their daily swing of about 2 %, raise nothing", async () => {
    for (const name of ["nmdb-2025-07-quiet.txt", "nmdb-2026-10-quiet.txt"]) {
      expect(cosmicRaysFrom(await fixture(name)).forbush).toBeNull();
    }
  });

  test("a drop at one monitor that the other does not share is not an event", async () => {
    // Flatten Rome to a constant: Dourbes' fall in May 2024 then has no confirmation.
    const text = (await fixture("nmdb-2024-05-forbush.txt")).replace(/^(\d{4}-\d{2}-\d{2} [\d:]+);\s*[\d.]+;/gm, "$1;120.000;");
    expect(cosmicRaysFrom(text).forbush).toBeNull();
  });

  test("percent change is measured from each monitor's own median", async () => {
    const { stations } = cosmicRaysFrom(await fixture("nmdb-2026-10-quiet.txt"));
    const rome = stations.find((s) => s.code === "ROME");
    expect(rome?.baselineCps).toBeGreaterThan(120);
    expect(Math.max(...(rome?.points.map((p) => Math.abs(p.pct)) ?? [99]))).toBeLessThan(2.5);
    expect(rome?.latest.at).toBe(Date.parse("2026-10-08T23:00:00Z"));
  });
});

const bgs = async (name: string): Promise<BgsRaw> => JSON.parse(await fixture(name)) as BgsRaw;

/** The reply as it would have looked at `iso`: later minutes are still in the arrays, but empty. */
function asOf(raw: BgsRaw, iso: string): BgsRaw {
  const cut = Date.parse(iso);
  return {
    datetime: raw.datetime,
    X: raw.X.map((v, i) => (Date.parse(raw.datetime[i] as string) > cut ? null : v)),
    Y: raw.Y.map((v, i) => (Date.parse(raw.datetime[i] as string) > cut ? null : v)),
  };
}

describe("magnetic field", () => {
  test("a quiet day at Fürstenfeldbruck reads calm", async () => {
    const reading = fieldFrom(await bgs("fur-2026-10-quiet.json"), Date.parse("2026-10-09T00:00:00Z"));
    expect(reading?.level).toBe("calm");
    expect(reading?.range3hNt).toBeLessThan(40);
    expect(reading?.hNt).toBeGreaterThan(20_000);
    expect(reading?.series.length).toBeGreaterThan(280);
  });

  test("the night of the May 2024 storm reads as a storm", async () => {
    const raw = await bgs("fur-2024-05-storm.json");
    const reading = fieldFrom(asOf(raw, "2024-05-11T12:00:00Z"), Date.parse("2024-05-11T12:05:00Z"));
    expect(reading?.level).toBe("storm");
    expect(reading?.range3hNt).toBeGreaterThan(250);
  });

  test("an observatory with no minute from the last three hours is offline", async () => {
    const raw = await bgs("fur-2026-10-quiet.json");
    expect(fieldFrom(raw, Date.parse("2026-10-09T04:00:00Z"))).toBeNull();
  });

  test("an observatory that sends only empty minutes is offline", () => {
    const empty: BgsRaw = { datetime: ["2026-10-08T00:00:00.000Z", "2026-10-08T00:01:00.000Z"], X: [null, null], Y: [null, null] };
    expect(fieldFrom(empty, Date.parse("2026-10-08T00:10:00Z"))).toBeNull();
  });

  test("levels step at 40, 70 and 120 nT", () => {
    expect([0, 39.9, 40, 69.9, 70, 119.9, 120, 400].map(fieldLevel)).toEqual(["calm", "calm", "unsettled", "unsettled", "active", "active", "storm", "storm"]);
  });
});

describe("shortwave bands", () => {
  test("a single bounce lands at most about 4,100 km away for a layer at 350 km", () => {
    expect(maxHopKm(350)).toBeGreaterThan(4_000);
    expect(maxHopKm(350)).toBeLessThan(4_250);
  });

  test("below the critical frequency a signal returns from straight overhead", () => {
    expect(bandReach(4.05, 350, 3.6)).toMatchObject({ state: "near", fromKm: 0 });
  });

  test("the skip distance grows with frequency until the band closes", () => {
    const reach = BANDS.map((b) => bandReach(4.05, 350.4, b.mhz));
    expect(reach.map((r) => r.state)).toEqual(["near", "skip", "skip", "closed", "closed", "closed", "closed", "closed"]);
    const [, forty, thirty] = reach;
    expect(forty?.fromKm).toBeGreaterThan(900);
    expect(forty?.fromKm).toBeLessThan(1_200);
    expect(thirty?.fromKm).toBeGreaterThan(1_800);
    expect(thirty?.fromKm).toBeLessThan(2_100);
  });

  test("a high critical frequency opens the upper bands", () => {
    const reach = BANDS.map((b) => bandReach(7, 300, b.mhz));
    expect(reach.filter((r) => r.state !== "closed").map((r) => r.name)).toEqual(["80 m", "40 m", "30 m", "20 m", "17 m", "15 m"]);
  });
});

describe("ionosondes", () => {
  const NOW = Date.parse("2026-10-09T00:35:00Z");
  const soundings = async (): Promise<SoundingRaw[]> => JSON.parse(await fixture("kc2g-2026-10-09.json")) as SoundingRaw[];

  test("from Rome the nearest fresh station is Rome's, compared with Dourbes", async () => {
    const info = ionosphereFrom(await soundings(), { lat: 41.9, lon: 12.5 }, NOW);
    expect(info.main.code).toBe("RO041");
    expect(info.main.foF2).toBe(4.05);
    expect(info.main.muf3000).toBeCloseTo(11.413, 3);
    expect(info.other?.code).toBe("DB049");
    expect(info.bands).toHaveLength(BANDS.length);
  });

  test("from Brussels the nearest is Dourbes, compared with Rome", async () => {
    const info = ionosphereFrom(await soundings(), { lat: 50.85, lon: 4.35 }, NOW);
    expect(info.main.code).toBe("DB049");
    expect(info.other?.code).toBe("RO041");
  });

  test("an old Rome entry and a station without a layer height are never chosen", async () => {
    const codes = new Set<string>();
    for (const at of [{ lat: 41.9, lon: 12.5 }, { lat: 52.2, lon: 21.1 }, { lat: 37.9, lon: 14 }]) {
      const info = ionosphereFrom(await soundings(), at, NOW);
      codes.add(info.main.code);
      if (info.other) codes.add(info.other.code);
    }
    expect(codes.has("RM041")).toBe(false);
    expect(codes.has("RA041")).toBe(false);
    expect(codes.has("MZ152")).toBe(false);
  });

  test("a place far from every ionosonde gets an honest refusal", async () => {
    const rows = await soundings();
    expect(() => ionosphereFrom(rows, { lat: -33.9, lon: 151.2 }, NOW)).toThrow(/No ionosonde/);
    expect(() => ionosphereFrom([], { lat: 41.9, lon: 12.5 }, NOW)).toThrow(/No ionosonde/);
  });
});

describe("nearest observatory", () => {
  const empty: BgsRaw = { datetime: [], X: [], Y: [] };

  /** The quiet-day reply moved in time so that its newest minute lies five minutes before `now`. */
  async function liveAt(now: number): Promise<BgsRaw> {
    const raw = await bgs("fur-2026-10-quiet.json");
    const shift = now - 5 * 60_000 - Date.parse(raw.datetime.at(-1) as string);
    return { ...raw, datetime: raw.datetime.map((t) => new Date(Date.parse(t) + shift).toISOString()) };
  }

  const brussels = { lat: 50.85, lon: 4.35 };

  test("a failing observatory is named and a farther one still answers", async () => {
    const now = Date.parse("2026-10-09T00:00:00Z");
    const reply = await liveAt(now);
    const field = await loadField(brussels, now, async (code) => {
      if (code === "DOU") throw new HttpError(502, "upstream_status", "INTERMAGNET DOU via BGS answered HTTP 503");
      return code === "WNG" ? reply : empty;
    });
    expect(field.code).toBe("WNG");
    expect(field.skipped.some((s) => s.startsWith("Dourbes (") && s.includes("503"))).toBe(true);
    expect(field.skipped).toContain("Manhay");
  });

  test("a silent observatory is not fetched again within the hour", async () => {
    const start = Date.parse("2026-11-01T00:00:00Z");
    const reads: string[] = [];
    const run = async (now: number): Promise<void> => {
      const reply = await liveAt(now);
      await loadField(brussels, now, async (code) => {
        reads.push(code);
        return code === "WNG" ? reply : empty;
      });
    };
    await run(start);
    expect(reads.filter((c) => c === "MAB")).toHaveLength(1);
    await run(start + 30 * 60_000);
    expect(reads.filter((c) => c === "MAB")).toHaveLength(1);
    await run(start + 61 * 60_000);
    expect(reads.filter((c) => c === "MAB")).toHaveLength(2);
  });
});
