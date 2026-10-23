import { describe, expect, test } from "bun:test";
import { balloonId, balloonName, lapsAround, linkOf, thinEvenly, toBalloons, toFlight } from "./amateur.server";

const NOW = Date.UTC(2026, 9, 8, 23, 30, 0);
const iso = (ms: number): string => new Date(ms).toISOString();

/** A frame as SondeHub serves it, with the fields that identify people: call signs, a receiver position, a comment. */
function frame(at: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datetime: iso(at),
    payload_callsign: "SP6MPL-34",
    uploader_callsign: "JA8VCW",
    uploader_position: "43.10,141.29",
    comment: "Contact Jane Example at jane@example.org",
    detail: "SP6MPL on WSPR channel-581",
    type: "Jetpack",
    modulation: "WSPR (SA6BSS)",
    lat: 40,
    lon: 10,
    alt: 13780,
    vel_h: 19.5,
    temp: -40,
    frequency: 14.097,
    days_aloft: 555,
    launch_date: "2025-04-02",
    ...over,
  };
}

function series(callsign: string, frames: Record<string, unknown>[]): [string, Record<string, unknown>] {
  return [callsign, Object.fromEntries(frames.map((f) => [String(f.datetime), f]))];
}

describe("balloons", () => {
  test("nothing that names a person reaches the output", () => {
    const callsigns = new Map<string, string>();
    const raw = Object.fromEntries([series("SP6MPL-34", [frame(NOW - 3_600_000), frame(NOW - 60_000, { lon: 11 })])]);
    const balloons = toBalloons(raw, NOW, callsigns);
    const text = JSON.stringify(balloons);
    for (const secret of ["SP6MPL", "JA8VCW", "SA6BSS", "Jane", "example.org", "43.10", "channel-581", "Jetpack"]) expect(text).not.toContain(secret);
    expect(balloons[0]?.name).toMatch(/^WSPR balloon [0-9A-F]{4}$/);
    expect(callsigns.get(balloons[0]?.id ?? "")).toBe("SP6MPL-34");
  });

  test("keeps balloons that are airborne and recently heard, and drops the rest", () => {
    const raw = Object.fromEntries([
      series("AAA1", [frame(NOW - 120_000)]),
      series("BBB2", [frame(NOW - 120_000, { alt: 86 })]),
      series("CCC3", [frame(NOW - 30 * 3_600_000)]),
    ]);
    expect(toBalloons(raw, NOW, new Map()).map((b) => b.name)).toEqual([`WSPR balloon ${balloonId("AAA1").slice(0, 4).toUpperCase()}`]);
  });

  test("shows the newest position first and tolerates missing optional fields", () => {
    const raw = Object.fromEntries([series("AAA1", [frame(NOW - 600_000, { lon: 5 }), frame(NOW - 60_000, { lon: 6, vel_h: null, days_aloft: undefined, temp: undefined })])]);
    const b = toBalloons(raw, NOW, new Map())[0];
    expect(b?.lon).toBe(6);
    expect(b?.speedMs).toBeNull();
    expect(b?.daysAloft).toBeNull();
    expect(b?.track.map((p) => p.lon)).toEqual([5, 6]);
  });

  test("the id is stable and is not the call sign", () => {
    expect(balloonId("SP6MPL-34")).toBe(balloonId("SP6MPL-34"));
    expect(balloonId("SP6MPL-34")).not.toBe(balloonId("SP6MPL-35"));
    expect(balloonId("SP6MPL-34")).toMatch(/^[0-9a-f]{8}$/);
  });

  test("link families", () => {
    expect(linkOf("WSPR (SA6BSS)")).toBe("WSPR");
    expect(linkOf("Horus Binary v3")).toBe("Horus");
    expect(linkOf("APRS")).toBe("APRS");
    expect(linkOf("LoRa Mode 2")).toBe("LoRa");
    expect(linkOf(undefined)).toBe("Other");
    expect(balloonName("0a1b2c3d", "Other")).toBe("Radio balloon 0A1B");
  });
});

describe("laps", () => {
  test("a balloon crossing the date line counts as moving east, not as going backwards", () => {
    expect(lapsAround([{ lon: 170 }, { lon: -170 }, { lon: -150 }])).toBeCloseTo(40 / 360, 5);
  });

  test("steps add up to whole laps, westward ones negative", () => {
    const east = Array.from({ length: 13 }, (_, i) => ({ lon: ((i * 60 + 180) % 360) - 180 }));
    expect(lapsAround(east)).toBeCloseTo(2, 5);
    expect(lapsAround([...east].reverse())).toBeCloseTo(-2, 5);
  });

  test("a flight reports laps, span and altitude range from the full-resolution track", () => {
    const day = 86_400_000;
    const frames = Array.from({ length: 13 }, (_, i) => frame(NOW - (12 - i) * day, { lon: ((i * 60 + 180) % 360) - 180, alt: 12000 + (i % 3) * 1000 }));
    const flight = toFlight("0a1b2c3d", Object.fromEntries(frames.map((f) => [String(f.datetime), f])));
    expect(flight.laps).toBe(2);
    expect(flight.spanDays).toBe(12);
    expect(flight.maxAltM).toBe(14000);
    expect(flight.minAltM).toBe(12000);
  });
});

describe("thinEvenly", () => {
  test("keeps the first and last point", () => {
    const thinned = thinEvenly(Array.from({ length: 1000 }, (_, i) => i), 50);
    expect(thinned).toHaveLength(50);
    expect(thinned[0]).toBe(0);
    expect(thinned[49]).toBe(999);
  });
});
