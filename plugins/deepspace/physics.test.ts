import { describe, expect, test } from "bun:test";
import { describeBody, isFresh, parseVectorTable, readyEntry, type StateVector } from "./horizons.server";
import { dbmToWatts, distanceWords, joulePatience, lightTimeWords, powerWords, signalLeftWords } from "./physics";
import { makeScale } from "./scale";
import { drawDish, easeAzimuth, pointing } from "./dish";

describe("received power in words", () => {
  test("converts dBm to watts", () => {
    expect(dbmToWatts(0)).toBeCloseTo(0.001, 12);
    expect(dbmToWatts(-150)).toBeCloseTo(1e-18, 24);
  });

  test("names the scale a Voyager signal lives on", () => {
    expect(powerWords(-150)).toBe("about 1 billionth of a billionth of a watt");
    expect(powerWords(-155)).toBe("about 0.3 billionths of a billionth of a watt");
    expect(powerWords(-170)).toBe("about 10 trillionths of a billionth of a watt");
    expect(powerWords(-120)).toBe("about 1 millionth of a billionth of a watt");
    expect(powerWords(-100)).toBe("about 100 millionths of a billionth of a watt");
    expect(powerWords(-60)).toBe("about 1 billionth of a watt");
  });

  test("shows how long one joule takes, only when that is longer than a year", () => {
    expect(joulePatience(-155)).toContain("100 billion years");
    expect(joulePatience(-155)).toContain("times the age of the universe");
    expect(joulePatience(-90)).toContain("32 thousand years");
    expect(joulePatience(-30)).toBeNull();
  });
});

describe("light time and distance wording", () => {
  test("formats one-way light time at every scale", () => {
    expect(lightTimeWords(1.3)).toBe("1.3 s");
    expect(lightTimeWords(42)).toBe("42 s");
    expect(lightTimeWords(760)).toBe("12 min 40 s");
    expect(lightTimeWords(2901)).toBe("48 min");
    expect(lightTimeWords(86_022)).toBe("23 h 53 min");
    expect(signalLeftWords(83_640)).toBe("Signal left 23 h 14 min ago");
  });

  test("formats distances in km and miles", () => {
    expect(distanceWords(384_400, "metric")).toBe("384,400 km");
    expect(distanceWords(149_600_000, "metric")).toBe("149.6 million km");
    expect(distanceWords(25_788_873_496, "metric")).toBe("25.8 billion km");
    expect(distanceWords(25_788_873_496, "imperial")).toBe("16 billion miles");
  });
});

describe("Horizons vectors", () => {
  const TABLE = `$$SOE
2461322.000000000, A.D. 2026-Oct-08 12:00:00.0000, -4.812860984629456E+09, -2.047748868963042E+10,  1.481584706871011E+10, -2.069848186756743E+00, -1.361129227293841E+01,  9.831883647174511E+00,
2461322.000694444, A.D. 2026-Oct-08 12:01:00.0000, -4.812861108820346E+09, -2.047748950630795E+10,  1.481584765862313E+10, -2.069848180264612E+00, -1.361129227275324E+01,  9.831883640409725E+00,
$$EOE`;

  test("reads the first row as a state vector at the right instant", () => {
    const v = parseVectorTable(TABLE);
    expect(v?.pos[0]).toBeCloseTo(-4.812860984629456e9, 0);
    expect(v?.vel[1]).toBeCloseTo(-13.61129227293841, 10);
    // 2026-10-08 12:00 TDB is 69.184 s before 12:00 UTC on the clock of a UTC reader.
    expect(new Date(v?.epochMs ?? 0).toISOString()).toBe("2026-10-08T11:58:50.816Z");
  });

  test("returns null for text with no table", () => {
    expect(parseVectorTable('No ephemeris for target "MAVEN (spacecraft)"')).toBeNull();
  });

  test("projects along velocity and derives distances, speed and light time", () => {
    const earth = { kind: "state" as const, epochMs: 0, pos: [1.5e8, 0, 0] as [number, number, number], vel: [0, 30, 0] as [number, number, number] };
    const probe = { kind: "state" as const, epochMs: 0, pos: [1.5e8, 3e8, 0] as [number, number, number], vel: [0, 10, 0] as [number, number, number] };
    const body = describeBody({ id: -1, name: "Test" }, "probe", probe, earth, 1000 * 1000);
    expect(body.pos[1]).toBeCloseTo(3e8 + 10 * 1000, 3);
    expect(body.distEarthKm).toBeCloseTo(3e8 - 20 * 1000, 3);
    expect(body.speedKmS).toBe(10);
    expect(body.lightSeconds).toBeCloseTo(body.distEarthKm / 299_792.458, 6);
    expect(body.radialKmS).toBeGreaterThan(0);
  });
});

describe("orrery scale", () => {
  test("is linear to Jupiter and logarithmic beyond, continuous at the knee, and ends at the rim", () => {
    const scale = makeScale("system", 172);
    const knee = scale.radius(5.5);
    expect(scale.radius(2.75)).toBeCloseTo(knee / 2, 6);
    expect(scale.radius(5.5 + 1e-9)).toBeCloseTo(knee, 3);
    expect(scale.radius(11) - scale.radius(5.5)).toBeCloseTo(scale.radius(22) - scale.radius(11), 6);
    expect(scale.radius(172 * 1.04)).toBeCloseTo(440, 6);
  });

  test("the inner scale is linear out to 2 AU", () => {
    const scale = makeScale("inner", 172);
    expect(scale.radius(1)).toBeCloseTo(scale.radius(2) / 2, 6);
  });
});

describe("dish drawing", () => {
  test("points north at the horizon and straight up at the zenith", () => {
    expect(pointing(0, 0)).toEqual([0, 1, 0]);
    expect(pointing(90, 0)[0]).toBeCloseTo(1, 12);
    expect(pointing(0, 90)[2]).toBeCloseTo(1, 12);
  });

  test("draws the feed above the dish when it looks at the zenith, and along the pointing direction otherwise", () => {
    const zenith = drawDish(34, 0, 90);
    const horizon = drawDish(34, 90, 0);
    const [, topY] = zenith.beams.axis[1];
    expect(topY).toBeLessThan(zenith.feed[1]);
    // Looking east, the beam runs to the right on screen.
    expect(horizon.beams.axis[1][0]).toBeGreaterThan(horizon.feed[0]);
  });

  test("takes the short way round the compass", () => {
    expect(easeAzimuth(350, 10, 0.5)).toBeCloseTo(0, 6);
    expect(easeAzimuth(10, 350, 0.5)).toBeCloseTo(0, 6);
    expect(easeAzimuth(90, 100, 1)).toBeCloseTo(100, 6);
  });
});

describe("how fresh a loaded solution is", () => {
  const HOUR = 3_600_000;
  const now = Date.UTC(2026, 9, 9, 12);
  const state = (ageMs: number): StateVector => ({ kind: "state", epochMs: now - ageMs, pos: [1, 2, 3], vel: [0, 0, 0] });

  test("a state vector ages from the moment it describes, even when the disk cache only just handed it over", () => {
    const fromDisk = readyEntry(state(2.9 * HOUR), now);
    expect(isFresh(fromDisk, now)).toBe(true);
    // Counted from the read, as before, this would stay fresh for three more hours.
    expect(isFresh(fromDisk, now + 0.2 * HOUR)).toBe(false);
  });

  test("a body JPL has no trajectory for is asked about again only after twelve hours", () => {
    const none = readyEntry({ kind: "none", reason: "No ephemeris for target" }, now);
    expect(isFresh(none, now + 11 * HOUR)).toBe(true);
    expect(isFresh(none, now + 13 * HOUR)).toBe(false);
  });
});
