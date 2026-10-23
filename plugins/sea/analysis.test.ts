import { describe, expect, test } from "bun:test";
import { analyse, cleanSeries, toReading, type Sample } from "./analysis";

interface Fixture {
  startMs: number;
  readings: [number, number][];
}

/** Recorded readings from the IOC Sea Level Station Monitoring facility, as the gauges sent them. */
async function recorded(name: string): Promise<Sample[]> {
  const f = (await Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).json()) as Fixture;
  return f.readings.map(([s, mm]) => ({ t: f.startMs + s * 1000, v: mm / 1000 }));
}

/** Add `extra(t)` metres to every reading from `fromMs` on, to see what the detector says about a known disturbance. */
function inject(samples: Sample[], fromMs: number, extra: (sinceMs: number) => number): Sample[] {
  return samples.map((s) => (s.t < fromMs ? s : { t: s.t, v: s.v + extra(s.t - fromMs) }));
}

const hour = (iso: string): number => Date.parse(`${iso}Z`);

describe("recorded days", () => {
  test("the Hunga Tonga eruption wave at Catania is flagged unusual when it arrives, as an oscillation of about 20 minutes", async () => {
    const a = analyse(await recorded("catania-2022-01-15"));
    expect(a?.analysis.day.level).toBe("unusual");
    expect(a?.analysis.day.kind).toBe("oscillation");
    expect(a?.analysis.day.rangeM).toBeGreaterThan(0.2);
    expect(a?.analysis.day.periodMin).toBeGreaterThanOrEqual(15);
    expect(a?.analysis.day.periodMin).toBeLessThanOrEqual(25);
    // The biggest swing came the next morning, nine hours after the pressure wave itself.
    expect(a?.analysis.day.to).toBeGreaterThan(hour("2022-01-16T05:00:00"));
    expect(a?.analysis.day.to).toBeLessThan(hour("2022-01-16T07:30:00"));
  });

  test("the pressure wave itself, at 21:00 UTC, is only restless: one loud hour never reaches unusual alone", async () => {
    const before = (await recorded("catania-2022-01-15")).filter((s) => s.t < hour("2022-01-15T23:30:00"));
    const a = analyse(before);
    expect(a?.analysis.day.level).toBe("restless");
    expect(a?.analysis.day.rangeM).toBeLessThan(0.2);
  });

  test("hours after the wave has passed, the gauge reads normal again", async () => {
    const a = analyse(await recorded("catania-2022-01-15"));
    expect(a?.analysis.recent.level).toBe("normal");
  });

  test("a glassy gauge that slops 16 cm in half an hour is restless but not unusual", async () => {
    const a = analyse(await recorded("civitavecchia-2026-10-08"));
    expect(a?.analysis.quietM).toBeLessThan(0.02);
    expect(a?.analysis.day.rangeM).toBeGreaterThan(0.15);
    expect(a?.analysis.day.level).toBe("restless");
    expect(a?.analysis.day.to).toBeGreaterThan(hour("2026-10-08T05:30:00"));
    expect(a?.analysis.day.to).toBeLessThan(hour("2026-10-08T06:30:00"));
  });

  test("ordinary days at Anzio and Genoa raise no flag, even when a choppy gauge moves 27 cm", async () => {
    for (const name of ["anzio-2026-10-08", "genova-2026-10-08"]) {
      const a = analyse(await recorded(name));
      expect(a?.analysis.day.level).toBe("normal");
      expect(a?.analysis.recent.level).toBe("normal");
    }
  });

  test("readings every five minutes cannot see seiches, so the Belgian coast is never called unusual", async () => {
    const a = analyse(await recorded("ostend-2026-10-08"));
    expect(a?.analysis.coarse).toBe(true);
    expect(a?.analysis.day.level).not.toBe("unusual");
    const loud = analyse(inject(await recorded("ostend-2026-10-08"), hour("2026-10-08T12:00:00"), (since) => 0.8 * Math.sin((2 * Math.PI * since) / (20 * 60_000))));
    expect(loud?.analysis.day.level).toBe("restless");
  });
});

describe("known disturbances added to a recorded day", () => {
  const genoa = recorded("genova-2026-10-08");
  const NOON = hour("2026-10-08T12:00:00");

  test("a sudden 30 cm step is unusual and reads as a step", async () => {
    const a = analyse(inject(await genoa, NOON, () => 0.3));
    expect(a?.analysis.day.level).toBe("unusual");
    expect(a?.analysis.day.kind).toBe("step");
  });

  test("a 25 cm oscillation of 12 minutes is unusual and its period is found", async () => {
    const a = analyse(inject(await genoa, NOON, (since) => (since < 90 * 60_000 ? 0.125 * Math.sin((2 * Math.PI * since) / (12 * 60_000)) : 0)));
    expect(a?.analysis.day.level).toBe("unusual");
    expect(a?.analysis.day.kind).toBe("oscillation");
    expect(a?.analysis.day.periodMin).toBeGreaterThanOrEqual(10);
    expect(a?.analysis.day.periodMin).toBeLessThanOrEqual(14);
  });

  test("a 20 cm swing is restless, and a 6 cm swing is still normal at a gauge that usually moves 4 cm", async () => {
    const swing = (amplitude: number) => (since: number) => (since < 60 * 60_000 ? amplitude * Math.sin((2 * Math.PI * since) / (12 * 60_000)) : 0);
    expect(analyse(inject(await genoa, NOON, swing(0.1)))?.analysis.day.level).toBe("restless");
    expect(analyse(inject(await genoa, NOON, swing(0.03)))?.analysis.day.level).toBe("normal");
  });

  test("a disturbance in the last hour shows in `recent`; one from the morning does not", async () => {
    const readings = await genoa;
    const last = Math.max(...readings.map((s) => s.t));
    const fresh = analyse(inject(readings, last - 40 * 60_000, () => 0.35));
    expect(fresh?.analysis.recent.level).toBe("unusual");
    const old = analyse(inject(readings, hour("2026-10-08T03:00:00"), (since) => (since < 20 * 60_000 ? 0.35 : 0)));
    expect(old?.analysis.day.level).toBe("unusual");
    expect(old?.analysis.recent.level).toBe("normal");
  });
});

describe("bad readings", () => {
  test("a one-minute 80 m spike and gauges' no-data values are ignored", async () => {
    const readings = await recorded("genova-2026-10-08");
    const plain = analyse(readings);
    const dirty = readings.map((s, i) => (i % 400 === 7 ? { t: s.t, v: 80 } : i % 400 === 90 ? { t: s.t, v: -1 } : i % 400 === 200 ? { t: s.t, v: -999 } : s));
    expect(analyse(dirty)?.analysis.day.rangeM).toBeCloseTo(plain?.analysis.day.rangeM ?? NaN, 2);
  });

  test("an isolated 60 cm blip in quiet water is dropped as a glitch, not reported as a swing", () => {
    const calm: Sample[] = Array.from({ length: 300 }, (_, i) => ({ t: i * 60_000, v: 0.2 + 0.0001 * i }));
    const blip = calm.map((s, i) => (i === 150 ? { t: s.t, v: s.v + 0.6 } : s));
    expect(analyse(blip)?.analysis.day.level).toBe("normal");
  });

  test("a record shorter than an hour of readings is not judged", () => {
    expect(analyse(Array.from({ length: 20 }, (_, i) => ({ t: i * 60_000, v: 0.1 })))).toBeNull();
  });

  test("cleaning keeps one median reading per minute", () => {
    const series = cleanSeries([
      { t: 0, v: 1 },
      { t: 15_000, v: 1.1 },
      { t: 30_000, v: 1.2 },
      { t: 60_000, v: 2 },
    ]);
    expect(series).toEqual([
      { t: 0, v: 1.1 },
      { t: 60_000, v: 2 },
    ]);
  });
});

describe("chart grid", () => {
  test("a day of readings fits a one-minute grid of 1441 points, in millimetres, with gaps as null", async () => {
    const readings = await recorded("ostend-2026-10-08");
    const a = analyse(readings);
    if (!a) throw new Error("fixture should be analysable");
    const end = Math.max(...readings.map((s) => s.t));
    const gauge = { code: "oste", name: "Ostend", country: "Belgium", lat: 51.234, lon: 2.927, intervalMin: 5, valueM: 4.18, at: end, level: null };
    const reading = toReading(gauge, a, end);
    expect(reading.levelMm).toHaveLength(1441);
    expect(reading.tideFreeMm).toHaveLength(1441);
    expect(reading.levelMm[1440]).toBeGreaterThan(3000);
    expect(reading.levelMm.filter((v) => v === null).length).toBeGreaterThan(1000);
  });
});
