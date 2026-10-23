import { describe, expect, test } from "bun:test";
import { airSensors, archiveSlug, bfsSensors, highRadiation, noiseSensors, safecastSensors, scTime, street, type BfsProps, type ScRecord } from "./parse";
import { levelOf, sentenceFor } from "./scales";
import type { Sensor } from "./types";

function sc(locationId: number, sensorId: number, type: string, values: Record<string, string | number | null>, over: { indoor?: number; lat?: string; lon?: string; at?: string } = {}): ScRecord {
  return {
    timestamp: over.at ?? "2026-10-08 20:16:51",
    location: { id: locationId, latitude: over.lat ?? "41.882", longitude: over.lon ?? "12.53", indoor: over.indoor ?? 0 },
    sensor: { id: sensorId, sensor_type: { name: type } },
    sensordatavalues: Object.entries(values).map(([value_type, value]) => ({ value_type, value })),
  };
}

describe("air sensors", () => {
  test("a dust sensor and a climate sensor at the same place become one reading with temperature, humidity and sea-level pressure", () => {
    const sensors = airSensors([
      sc(41113, 54948, "BME280", { temperature: "20.32", pressure: "100923.78", humidity: "55.2", pressure_at_sealevel: 101506.6 }),
      sc(41113, 54947, "SDS011", { P1: "3.47", P2: "1.10" }),
    ]);
    expect(sensors).toHaveLength(1);
    const s = sensors[0] as Sensor;
    expect(s).toMatchObject({ id: "sc:41113", kind: "air", value: 1.1, unit: "µg/m³", level: "fine", live: true, historyKey: "sds011:54947" });
    expect(s.readings.map((r) => [r.label, r.value])).toEqual([
      ["PM2.5", 1.1],
      ["PM10", 3.47],
      ["Temperature", 20.32],
      ["Humidity", 55.2],
      ["Pressure", 1015.066],
    ]);
    expect(s.at).toBe(Date.UTC(2026, 9, 8, 20, 16, 51));
  });

  test("indoor units, dust sensors stuck at the ceiling and places with no dust sensor are left out", () => {
    const sensors = airSensors([
      sc(1, 11, "SDS011", { P1: "9", P2: "5" }, { indoor: 1 }),
      sc(2, 22, "SDS011", { P1: "999.9", P2: "999.9" }),
      sc(3, 33, "DHT22", { temperature: "18", humidity: "60" }),
      sc(4, 44, "PMS5003", { P1: "30", P2: "21.5" }),
    ]);
    expect(sensors.map((s) => s.id)).toEqual(["sc:4"]);
    expect(sensors[0]?.level).toBe("elevated");
    expect(sensors[0]?.historyKey).toBe("pms5003:44");
  });

  test("impossible humidity and temperature are not shown", () => {
    const s = airSensors([sc(5, 55, "SDS011", { P1: "8", P2: "4" }), sc(5, 56, "DHT22", { temperature: "-127", humidity: "400" })])[0] as Sensor;
    expect(s.readings.map((r) => r.label)).toEqual(["PM2.5", "PM10"]);
  });

  test("PM2.5 above 55 µg/m³ is high", () => {
    expect(airSensors([sc(6, 66, "SDS011", { P1: "120", P2: "78" })])[0]?.level).toBe("high");
  });
});

describe("noise sensors", () => {
  test("DNMS gives the average with the quietest and loudest moment", () => {
    const s = noiseSensors([sc(4781, 9486, "DNMS (Laerm)", { noise_LAeq: "36.20", noise_LA_max: "48.50", noise_LA_min: "30.47" }, { lat: "48.776", lon: "9.2" })])[0] as Sensor;
    expect(s).toMatchObject({ kind: "noise", value: 36.2, unit: "dB(A)", level: "fine", historyKey: "laerm:9486" });
    expect(s.readings.map((r) => r.value)).toEqual([36.2, 30.47, 48.5]);
  });

  test("readings that no sound-level meter could produce are dropped", () => {
    expect(noiseSensors([sc(1, 1, "DNMS (Laerm)", { noise_LAeq: "0.0" }), sc(2, 2, "DNMS (Laerm)", { noise_LAeq: "-1" })])).toEqual([]);
  });

  test("archive file names follow the sensor type", () => {
    expect(archiveSlug("SDS011")).toBe("sds011");
    expect(archiveSlug("DNMS (Laerm)")).toBe("laerm");
    expect(archiveSlug("PMS 5003")).toBe("pms5003");
  });
});

describe("radiation", () => {
  const props = (over: Partial<BfsProps>): BfsProps => ({ id: "DEZ0599", name: "Pulheim-Sinnersdorf", site_status: 1, end_measure: "2026-10-08T19:00:00Z", value: 0.094, value_cosmic: 0.043, value_terrestrial: 0.051, ...over });
  const feature = (p: BfsProps, lon = 6.82, lat = 51.01): { geometry: { coordinates: [number, number] }; properties: BfsProps } => ({ geometry: { coordinates: [lon, lat] }, properties: p });

  test("BfS stations give dose rate with the cosmic and ground share; stations out of service are skipped", () => {
    const sensors = bfsSensors([feature(props({})), feature(props({ id: "DEZ1", site_status: 0, value: null })), feature(props({ id: "DEZ2", end_measure: null }))]);
    expect(sensors).toHaveLength(1);
    expect(sensors[0]).toMatchObject({ id: "bfs:DEZ0599", name: "Pulheim-Sinnersdorf", value: 0.094, level: "fine", lat: 51.01, lon: 6.82, at: Date.UTC(2026, 9, 8, 19) });
    expect(sensors[0]?.readings.map((r) => r.label)).toEqual(["Dose rate", "From cosmic rays", "From the ground"]);
  });

  test("Safecast keeps the newest µSv/h reading per 300 m cell and ignores counts per minute and impossible values", () => {
    const sensors = safecastSensors([
      { value: 0.1, unit: "usv", captured_at: "2017-12-01T10:00:00.000Z", latitude: 50.85, longitude: 4.35 },
      { value: 0.12, unit: "usv", captured_at: "2023-05-01T10:00:00.000Z", latitude: 50.8501, longitude: 4.3501 },
      { value: 38, unit: "cpm", captured_at: "2024-01-01T10:00:00.000Z", latitude: 50.9, longitude: 4.4 },
      { value: 80, unit: "usv", captured_at: "2024-01-01T10:00:00.000Z", latitude: 50.91, longitude: 4.4 },
    ]);
    expect(sensors).toHaveLength(1);
    expect(sensors[0]).toMatchObject({ value: 0.12, live: false, historyKey: null, network: "safecast" });
    expect(sensors[0]?.at).toBe(Date.parse("2023-05-01T10:00:00.000Z"));
  });
});

describe("fixed Safecast units", () => {
  test("a reading from the last few hours counts as live and has no survey name", () => {
    const now = Date.UTC(2026, 9, 8, 20);
    const [fixed, old] = safecastSensors(
      [
        { value: 0.276, unit: "usv", captured_at: "2026-10-08T17:00:00.000Z", latitude: 41.8535, longitude: 12.479 },
        { value: 0.12, unit: "usv", captured_at: "2023-05-01T10:00:00.000Z", latitude: 41.9, longitude: 12.5 },
      ],
      now,
    ) as [Sensor, Sensor];
    expect(fixed).toMatchObject({ live: true, name: null });
    expect(old.live).toBe(false);
    expect(old.name).toBe("Survey May 2023");
  });
});

describe("choosing what is near you", () => {
  const rome = { lat: 41.9028, lon: 12.4964 };
  const brussels = { lat: 50.8503, lon: 4.3517 };
  const at = (over: Partial<Sensor> & Pick<Sensor, "kind" | "lat" | "lon" | "value">): Sensor => ({
    id: `x:${over.lat},${over.lon}`,
    network: "sensor.community",
    networkName: "",
    name: null,
    unit: "",
    level: "fine",
    at: 0,
    live: true,
    readings: [],
    historyKey: null,
    distanceM: 0,
    ...over,
  });

  test("in Rome a nearby survey reading beats a live station in Germany", () => {
    const munich = at({ kind: "radiation", lat: 48.1, lon: 11.6, value: 0.1 });
    const survey = at({ kind: "radiation", lat: 41.85, lon: 12.48, value: 0.14, live: false });
    expect(street(rome, [], [], [munich, survey]).radiation?.live).toBe(false);
  });

  test("in Brussels a live station within range wins over an older survey", () => {
    const aachen = at({ kind: "radiation", lat: 50.78, lon: 6.08, value: 0.09 });
    const survey = at({ kind: "radiation", lat: 50.85, lon: 4.35, value: 0.1, live: false });
    expect(street(brussels, [], [], [aachen, survey]).radiation?.id).toBe(aachen.id);
  });

  test("with nothing within range the nearest sensor is still reported, with its distance", () => {
    const far = at({ kind: "noise", lat: 50.84, lon: 5.8, value: 41 });
    const report = street(brussels, [], [far], []);
    expect(report.noise?.distanceM).toBeGreaterThan(100_000);
    expect(report.radiation).toBeNull();
  });

  test("the PM2.5 warning looks at sensors within 2 km and takes the worst", () => {
    const mild = at({ kind: "air", lat: 50.851, lon: 4.352, value: 20 });
    const bad = at({ kind: "air", lat: 50.855, lon: 4.355, value: 80 });
    const farBad = at({ kind: "air", lat: 50.95, lon: 4.5, value: 300 });
    expect(street(brussels, [mild, bad, farBad], [], []).pm25Near?.value).toBe(80);
    expect(street(brussels, [mild, farBad], [], []).pm25Near).toBeNull();
  });

  test("high radiation looks only at live stations within 20 km", () => {
    const near = at({ kind: "radiation", lat: 50.9, lon: 4.4, value: 0.5 });
    const survey = at({ kind: "radiation", lat: 50.85, lon: 4.35, value: 0.9, live: false });
    const far = at({ kind: "radiation", lat: 51.5, lon: 5.5, value: 0.9 });
    expect(highRadiation([near, survey, far], brussels).map((s) => s.value)).toEqual([0.5]);
  });
});

describe("scales and sentences", () => {
  test("thresholds meet at the boundaries", () => {
    expect(levelOf("air", 15)).toBe("fine");
    expect(levelOf("air", 15.1)).toBe("elevated");
    expect(levelOf("air", 55)).toBe("elevated");
    expect(levelOf("air", 55.1)).toBe("high");
    expect(levelOf("radiation", 0.199)).toBe("fine");
    expect(levelOf("radiation", 0.2)).toBe("elevated");
    expect(levelOf("radiation", 0.4)).toBe("high");
    expect(levelOf("noise", 54.9)).toBe("fine");
    expect(levelOf("noise", 70)).toBe("high");
  });

  test("humid air adds a caution to a dust reading", () => {
    expect(sentenceFor("air", 40, [{ label: "Humidity", value: 96, unit: "%" }], true)).toContain("fog");
    expect(sentenceFor("air", 40, [{ label: "Humidity", value: 50, unit: "%" }], true)).not.toContain("fog");
  });

  test("a survey reading says it is not live", () => {
    expect(sentenceFor("radiation", 0.1, [], false)).toContain("not from a station");
    expect(sentenceFor("radiation", 0.1, [], true)).toContain("normal background");
  });

  test("Sensor.Community timestamps are UTC", () => {
    expect(scTime("2026-10-08 20:16:51")).toBe(Date.UTC(2026, 9, 8, 20, 16, 51));
  });
});
