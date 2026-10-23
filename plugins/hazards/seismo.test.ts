import { describe, expect, test } from "bun:test";
import type { Trace } from "./miniseed";
import { NODES, VOLCANOES, VOLCANO_NODE, parseChannels, summarise } from "./seismo";

const iris = NODES[0] as (typeof NODES)[number];
const brussels = { lat: 50.8503, lon: 4.3517 };

const HEADER = "#Network | Station | Location | Channel | Latitude | Longitude | Elevation | Depth | Azimuth | Dip | SensorDescription | Scale | ScaleFreq | ScaleUnits | SampleRate | StartTime | EndTime";

describe("station list", () => {
  const text = [
    HEADER,
    "BE|UCC||HHZ|50.797241|4.36038|-41.0|141.0|0.0|-90.0|TrilliumCompactPH|3.0124E8|1.0|M/S|100.0|2018-10-29T09:00:00.0000|",
    "BE|UCC||HHN|50.797241|4.36038|-41.0|141.0|0.0|0.0|TrilliumCompactPH|3.0124E8|1.0|M/S|100.0|2018-10-29T09:00:00.0000|",
    "BE|UCC||BHZ|50.797241|4.36038|-41.0|141.0|0.0|-90.0|TrilliumCompactPH|3.0124E8|1.0|M/S|20.0|2018-10-29T09:00:00.0000|",
    "BE|OLD||HHZ|50.9|4.4|0|0|0|-90|x|1E9|1|M/S|100|2008-01-01T00:00:00|2016-05-30T23:59:59",
    "BE|ACC||HNZ|50.8|4.3|0|0|0|-90|accelerometer|1E6|1|M/S**2|100|2008-01-01T00:00:00|",
    "BE|SLOW||LHZ|50.8|4.3|0|0|0|-90|x|1E9|1|M/S|1|2008-01-01T00:00:00|",
    "BE|NOSCALE||HHZ|50.8|4.3|0|0|0|-90|x||1|M/S|100|2008-01-01T00:00:00|",
    "bad line",
    "BE|RCHB||EHZ|50.155156|5.226787|182.0|43.0|0.0|-90.0|x|4.7E8|1.0|m/s|100.0|2022-07-05T10:30:00.0000|",
    "BE|RCHB||HHZ|50.155156|5.226787|182.0|43.0|0.0|-90.0|x|4.7E8|1.0|m/s|100.0|2022-07-05T10:30:00.0000|",
  ].join("\n");

  test("keeps one open velocity channel per station, preferring broadband HH over BH and EH", () => {
    const list = parseChannels(text, iris, brussels);
    expect(list.map((c) => `${c.station.id}.${c.station.channel}`).sort()).toEqual(["BE.RCHB.HHZ", "BE.UCC.HHZ"]);
  });

  test("closed epochs, accelerometers, slow channels and channels without a sensitivity are left out", () => {
    const ids = parseChannels(text, iris, brussels).map((c) => c.station.code);
    for (const left of ["OLD", "ACC", "SLOW", "NOSCALE"]) expect(ids).not.toContain(left);
  });

  test("distance, operator and sensitivity come through", () => {
    const ucc = parseChannels(text, iris, brussels).find((c) => c.station.code === "UCC");
    expect(ucc?.station.distanceKm).toBeCloseTo(6, 0);
    expect(ucc?.station.operator).toBe("Royal Observatory of Belgium");
    expect(ucc?.station.citizen).toBe(false);
    expect(ucc?.scale).toBe(3.0124e8);
  });

  test("a station name that is not a plain code is refused, since it goes into a URL", () => {
    expect(parseChannels(`${HEADER}\nBE|U&CC||HHZ|50|4|0|0|0|-90|x|1E9|1|M/S|100|2020-01-01T00:00:00|`, iris, brussels)).toEqual([]);
  });
});

describe("trace summary", () => {
  const START = Date.UTC(2026, 9, 8, 20, 0, 0);
  const RATE = 50;
  const WINDOW = 600_000;
  const samples = (f: (t: number) => number, seconds = 600): Float64Array => Float64Array.from({ length: seconds * RATE }, (_, i) => f(i / RATE));

  test("counts become nm/s using the sensitivity, and the peak matches the signal", () => {
    // 1 Hz wave of 1000 counts amplitude on a sensor of 1e6 counts per m/s: 1 mm/s = 1e6 nm/s.
    const trace: Trace = { startMs: START, sampleRate: RATE, samples: samples((t) => 1000 * Math.sin(2 * Math.PI * t)) };
    const s = summarise(trace, 1e6, START, START + WINDOW);
    expect(s?.bins).toHaveLength(900);
    expect(s?.peakNmS).toBeGreaterThan(0.95e6);
    expect(s?.peakNmS).toBeLessThan(1.05e6);
    expect(s?.rmsNmS).toBeGreaterThan(0.66e6);
    expect(s?.rmsNmS).toBeLessThan(0.75e6);
  });

  test("a constant offset and a slow drift do not count as motion", () => {
    const trace: Trace = { startMs: START, sampleRate: RATE, samples: samples((t) => 200_000 + t * 5) };
    const s = summarise(trace, 1e9, START, START + WINDOW);
    expect(s?.peakNmS).toBeLessThan(500);
  });

  test("time the station did not record reads as zero instead of a spike", () => {
    // Only the last five minutes exist; the first five minutes of the window are a gap.
    const trace: Trace = { startMs: START + 300_000, sampleRate: RATE, samples: samples((t) => 100 * Math.sin(2 * Math.PI * t), 300) };
    const s = summarise(trace, 1e6, START, START + WINDOW);
    expect(s?.bins[0]).toEqual([0, 0]);
    expect(s?.bins[899]?.[1]).toBeGreaterThan(0);
  });

  test("gaps inside the data (NaN) read as zero", () => {
    const data = samples(() => 50);
    data.fill(Number.NaN, 1000, 2000);
    const s = summarise({ startMs: START, sampleRate: RATE, samples: data }, 1e6, START, START + WINDOW);
    expect(Number.isFinite(s?.peakNmS)).toBe(true);
  });

  test("a trace with no readable sample gives nothing", () => {
    expect(summarise({ startMs: START, sampleRate: RATE, samples: new Float64Array(100).fill(Number.NaN) }, 1e6, START, START + WINDOW)).toBeNull();
  });
});

describe("volcano stations", () => {
  // Rows as INGV's station service sent them for the area around Etna's summit craters.
  const etna = [
    HEADER,
    "IV|ECPN||HHZ|37.7437|14.9865|3038|0|0|-90|NANOMETRICS TRILLIUM-40S|621200000|0.2|m/s|100|2020-06-16T12:32:09|",
    "IV|ECPN||HHN|37.7437|14.9865|3038|0|0|0|NANOMETRICS TRILLIUM-40S|621200000|0.2|m/s|100|2020-06-16T12:32:09|",
    "IV|EPLC||HHZ|37.7651|14.9857|2698|0|0|-90|x|621200000|0.2|m/s|100|2024-01-04T14:45:25|",
    "IV|EPLC||HNZ|37.7651|14.9857|2698|0|0|-90|accelerometer|417861|0.2|m/s**2|200|2024-01-04T14:45:25|",
    "IV|EFIU||HHZ|37.7896|15.2103|97|0|0|-90|x|614502000|0.2|m/s|100|2022-12-01T10:00:00|",
  ].join("\n");
  const etnaSummit = VOLCANOES[0].summit;

  test("distances are measured from the crater, so the list sorts into the order a viewer expects", () => {
    const list = parseChannels(etna, VOLCANO_NODE, etnaSummit).sort((a, b) => a.station.distanceKm - b.station.distanceKm);
    expect(list.map((c) => c.station.code)).toEqual(["ECPN", "EPLC", "EFIU"]);
    expect(list[0]?.station.distanceKm).toBeGreaterThan(0.5);
    expect(list[0]?.station.distanceKm).toBeLessThan(1.5);
    expect(list[0]?.station.channel).toBe("HHZ");
  });

  test("the search stays on INGV's national network within a few kilometres of the summit", () => {
    expect(VOLCANO_NODE.network).toBe("IV");
    expect(VOLCANO_NODE.radiusDeg).toBeLessThan(0.2);
    expect(VOLCANOES.map((v) => v.id)).toEqual(["etna", "stromboli", "campi-flegrei"]);
  });
});
