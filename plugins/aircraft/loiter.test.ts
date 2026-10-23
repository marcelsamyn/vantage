import { describe, expect, test } from "bun:test";
import { destination, distanceM, type LatLon } from "../../shared/geo";
import { boundingCircle, detectLoiter, remember, turning, type Fix, type FixHistory } from "./loiter";
import type { Aircraft } from "./types";

const ROME: LatLon = { lat: 41.889, lon: 12.47 };
const T0 = Date.UTC(2026, 9, 8, 12, 0, 0);
const STEP_S = 10;

/** A path flown in segments; every segment adds fixes every 10 seconds. Speeds in m/s. */
type Leg = { kind: "line"; bearing: number; speed: number; seconds: number } | { kind: "arc"; speed: number; radiusM: number; degrees: number; clockwise: boolean };

function fly(start: LatLon, startBearing: number, legs: Leg[], startAt = T0): Fix[] {
  const fixes: Fix[] = [{ ...start, at: startAt }];
  let pos = start;
  let heading = startBearing;
  let at = startAt;
  for (const leg of legs) {
    const seconds = leg.kind === "line" ? leg.seconds : ((leg.degrees / 360) * 2 * Math.PI * leg.radiusM) / leg.speed;
    const turnPerS = leg.kind === "arc" ? ((leg.speed / leg.radiusM) * 180) / Math.PI * (leg.clockwise ? 1 : -1) : 0;
    if (leg.kind === "line") heading = leg.bearing;
    for (let t = STEP_S; t <= seconds + 1e-9; t += STEP_S) {
      // Advance along the mean heading of the step so the arc closes.
      const mean = heading + (turnPerS * STEP_S) / 2;
      pos = destination(pos, mean, leg.speed * STEP_S);
      heading += turnPerS * STEP_S;
      at += STEP_S * 1000;
      fixes.push({ ...pos, at });
    }
  }
  return fixes;
}

const end = (fixes: Fix[]): number => (fixes[fixes.length - 1] as Fix).at;
const KT = 0.514444;

describe("detectLoiter", () => {
  test("a straight line is not loitering", () => {
    const track = fly(ROME, 90, [{ kind: "line", bearing: 90, speed: 200 * KT, seconds: 20 * 60 }]);
    expect(detectLoiter(track, end(track))).toBeNull();
  });

  test("a single full circle is not enough", () => {
    const track = fly(ROME, 0, [
      { kind: "line", bearing: 0, speed: 60, seconds: 120 },
      { kind: "arc", speed: 60, radiusM: 1500, degrees: 360, clockwise: true },
      { kind: "line", bearing: 0, speed: 60, seconds: 120 },
    ]);
    const lastAt = end(track);
    expect(detectLoiter(track, lastAt)).toBeNull();
    // Even a little earlier, mid-circle, it is not yet 540 degrees.
    expect(detectLoiter(track.filter((f) => f.at <= lastAt - 100_000), lastAt - 100_000)).toBeNull();
  });

  test("two orbits over one spot are loitering", () => {
    const track = fly(ROME, 0, [{ kind: "arc", speed: 60, radiusM: 1500, degrees: 720, clockwise: false }]);
    const result = detectLoiter(track, end(track));
    expect(result).not.toBeNull();
    expect(result?.direction).toBe("anticlockwise");
    expect(result?.turnDeg).toBeGreaterThanOrEqual(540);
    expect(result?.radiusM).toBeGreaterThan(1300);
    expect(result?.radiusM).toBeLessThan(1800);
    // The centre of the orbit is about one radius from the first fix.
    expect(distanceM(result?.center ?? ROME, ROME)).toBeLessThan(3000);
  });

  test("it is caught after 540 degrees, not at the end of the second orbit", () => {
    const track = fly(ROME, 0, [{ kind: "arc", speed: 60, radiusM: 1500, degrees: 900, clockwise: true }]);
    const early = track.filter((f) => f.at <= T0 + 4.5 * 60_000);
    const late = track.filter((f) => f.at <= T0 + 7 * 60_000);
    // 540 degrees at 2.3 degrees per second takes 3 min 55 s.
    expect(detectLoiter(early, end(early))).not.toBeNull();
    expect(detectLoiter(late, end(late))?.minutes).toBeGreaterThanOrEqual(6);
  });

  test("a long orbit reports how long it has lasted", () => {
    const track = fly(ROME, 0, [{ kind: "arc", speed: 50, radiusM: 1200, degrees: 360 * 8, clockwise: true }]);
    const result = detectLoiter(track, end(track));
    const minutes = (end(track) - T0) / 60_000;
    expect(minutes).toBeGreaterThan(17);
    expect(result?.minutes).toBeCloseTo(minutes, 0);
  });

  test("an airliner holding pattern is wider than the circle and is not loitering", () => {
    // Four-minute racetrack at 220 knots: one-minute legs and standard-rate turns.
    const v = 220 * KT;
    const turnRadius = v / ((3 * Math.PI) / 180);
    const lap: Leg[] = [
      { kind: "line", bearing: 0, speed: v, seconds: 60 },
      { kind: "arc", speed: v, radiusM: turnRadius, degrees: 180, clockwise: true },
      { kind: "line", bearing: 180, speed: v, seconds: 60 },
      { kind: "arc", speed: v, radiusM: turnRadius, degrees: 180, clockwise: true },
    ];
    const track = fly(ROME, 0, [...lap, ...lap, ...lap, ...lap]);
    expect(turning(track.filter((f) => f.at > end(track) - 15 * 60_000)).clockwise).toBeGreaterThan(540);
    expect(boundingCircle(track).radiusM * 2).toBeGreaterThan(6000);
    expect(detectLoiter(track, end(track))).toBeNull();
  });

  test("a figure of eight turns both ways and never adds up to 540 degrees in one direction", () => {
    const loop = (clockwise: boolean): Leg => ({ kind: "arc", speed: 60, radiusM: 1000, degrees: 360, clockwise });
    const track = fly(ROME, 0, [loop(true), loop(false)]);
    expect(detectLoiter(track, end(track))).toBeNull();
  });

  test("a helicopter hovering in place is not loitering", () => {
    const track: Fix[] = Array.from({ length: 80 }, (_, i) => ({ lat: ROME.lat + (i % 2) * 1e-5, lon: ROME.lon, at: T0 + i * STEP_S * 1000 }));
    expect(detectLoiter(track, end(track))).toBeNull();
  });

  test("an orbit that ended more than 15 minutes ago is over", () => {
    const track = fly(ROME, 0, [{ kind: "arc", speed: 60, radiusM: 1500, degrees: 720, clockwise: true }]);
    expect(detectLoiter(track, end(track) + 16 * 60_000)).toBeNull();
  });

  test("a flight that arrives from far away is caught once it starts orbiting", () => {
    const track = fly(ROME, 90, [
      { kind: "line", bearing: 90, speed: 70, seconds: 10 * 60 },
      { kind: "arc", speed: 60, radiusM: 1500, degrees: 720, clockwise: true },
    ]);
    const result = detectLoiter(track, end(track));
    expect(result).not.toBeNull();
    expect(result?.minutes).toBeLessThan(9);
    expect(distanceM(result?.path[0] ?? ROME, ROME)).toBeGreaterThan(10_000);
  });
});

function plane(over: Partial<Aircraft> = {}): Aircraft {
  return {
    hex: "3c6444",
    callsign: null,
    registration: null,
    typeCode: null,
    typeName: null,
    ownerOperator: null,
    year: null,
    lat: ROME.lat,
    lon: ROME.lon,
    altFt: 1200,
    onGround: false,
    speedKt: 90,
    iasKt: null,
    tasKt: null,
    mach: null,
    trackDeg: 0,
    vertRateFpm: 0,
    selectedAltFt: null,
    selectedHeadingDeg: null,
    autopilotModes: [],
    windFromDeg: null,
    windKt: null,
    squawk: null,
    emergency: null,
    category: "A7",
    outsideAirC: null,
    military: false,
    notable: false,
    privacyProgramme: null,
    positionSource: "ADS-B",
    posAgeS: 0,
    ...over,
  };
}

describe("remember", () => {
  test("keeps fixes of flying aircraft near you, including those in privacy programmes, and skips grounded and distant ones", () => {
    const history: FixHistory = new Map();
    const far = destination(ROME, 90, 90_000);
    remember(
      history,
      {
        fetchedAt: T0,
        aircraft: [plane(), plane({ hex: "aaaaaa", onGround: true }), plane({ hex: "bbbbbb", lat: far.lat, lon: far.lon }), plane({ hex: "cccccc", privacyProgramme: "FAA LADD" })],
      },
      ROME,
    );
    expect([...history.keys()]).toEqual(["3c6444", "cccccc"]);
  });

  test("ignores a repeated position and stamps fixes with the time the receiver saw them", () => {
    const history: FixHistory = new Map();
    remember(history, { fetchedAt: T0, aircraft: [plane({ posAgeS: 4 })] }, ROME);
    remember(history, { fetchedAt: T0 + 10_000, aircraft: [plane({ posAgeS: 14 })] }, ROME);
    expect(history.get("3c6444")).toEqual([{ lat: ROME.lat, lon: ROME.lon, at: T0 - 4000 }]);
    remember(history, { fetchedAt: T0 + 20_000, aircraft: [plane({ lat: ROME.lat + 0.001, posAgeS: 1 })] }, ROME);
    expect(history.get("3c6444")).toHaveLength(2);
  });

  test("forgets aircraft that have not been heard for five minutes", () => {
    const history: FixHistory = new Map();
    remember(history, { fetchedAt: T0, aircraft: [plane()] }, ROME);
    remember(history, { fetchedAt: T0 + 6 * 60_000, aircraft: [] }, ROME);
    expect(history.size).toBe(0);
  });
});
