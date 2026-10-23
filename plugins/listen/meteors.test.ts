import { describe, expect, test } from "bun:test";
import { isEurope, parseSummary, summarise } from "./meteors.server";

const NAMES: Record<number, string> = { 0: "Unique trajectory", 4: "IAU", 59: "Vinit", 63: "LatBeg", 65: "LonBeg", 67: "HtBeg", 69: "LatEnd", 71: "LonEnd", 73: "HtEnd", 75: "Duration", 76: "Peak", 79: "Mass kg", 84: "Num", 85: "Participating" };

function header(overrides: Record<number, string> = {}): string {
  const cells = Array.from({ length: 86 }, (_, i) => ({ ...NAMES, ...overrides })[i] ?? "+/-");
  return `#  ${cells.join(";      ")}`;
}

interface Fields {
  id: string;
  time: string;
  shower: string;
  speed: string;
  latBeg: string;
  lonBeg: string;
  htBeg: string;
  latEnd: string;
  lonEnd: string;
  htEnd: string;
  duration: string;
  mag: string;
  mass: string;
  cameras: string;
  stations: string;
}

function row(over: Partial<Fields> = {}): string {
  const f: Fields = {
    id: "20261007024501_LdiWn",
    time: "2026-10-07 02:45:01.230745",
    shower: "...",
    speed: "69.45",
    latBeg: "45.40",
    lonBeg: "19.64",
    htBeg: "125.9",
    latEnd: "45.70",
    lonEnd: "19.00",
    htEnd: "82.9",
    duration: "1.09",
    mag: "-5.78",
    mass: "5.86e-03",
    cameras: "9",
    stations: "HR002J,HU0004",
    ...over,
  };
  const cells = Array.from({ length: 86 }, () => "   0.0");
  const set = (i: number, v: string): void => void (cells[i] = v);
  set(0, f.id);
  set(2, f.time);
  set(4, f.shower);
  set(59, f.speed);
  set(63, f.latBeg);
  set(65, f.lonBeg);
  set(67, f.htBeg);
  set(69, f.latEnd);
  set(71, f.lonEnd);
  set(73, f.htEnd);
  set(75, f.duration);
  set(76, f.mag);
  set(79, f.mass);
  set(84, f.cameras);
  set(85, f.stations);
  return cells.join(";   ");
}

/** The real file ends its lines with "\n\r". */
const file = (...rows: string[]): string => ["# Summary generated on 2026-10-08", header(), "#      identifier   ;", "# ------------------;", ...rows].join("\n\r");

describe("parseSummary", () => {
  test("reads a meteor with its shower, heights and cameras", () => {
    const { meteors } = parseSummary(file(row({ shower: "STA", latBeg: "41.9", lonBeg: "12.5" })));
    expect(meteors).toHaveLength(1);
    expect(meteors[0]).toMatchObject({
      id: "20261007024501_LdiWn",
      at: Date.UTC(2026, 9, 7, 2, 45, 1, 230),
      shower: "STA",
      showerName: "Southern Taurids",
      begin: { lat: 41.9, lon: 12.5, heightKm: 125.9 },
      end: { lat: 45.7, lon: 19, heightKm: 82.9 },
      speedKms: 69.45,
      peakMag: -5.78,
      massKg: 0.00586,
      cameras: 9,
      europe: true,
      stations: ["HR002J", "HU0004"],
    });
  });

  test("sporadic meteors have no shower, and an unknown code keeps its code without a name", () => {
    const { meteors } = parseSummary(file(row({ shower: "..." }), row({ id: "20261007024502_AAAAA", shower: "ZZZ" })));
    expect(meteors[0]).toMatchObject({ shower: null, showerName: null });
    expect(meteors[1]).toMatchObject({ shower: "ZZZ", showerName: null });
  });

  test("drops rows with missing numbers, impossible heights or a single camera", () => {
    const { meteors } = parseSummary(
      file(
        row({ id: "20261007024503_BBBBB" }),
        row({ id: "20261007024504_CCCCC", mag: "nan" }),
        row({ id: "20261007024505_DDDDD", htBeg: "70", htEnd: "90" }),
        row({ id: "20261007024506_EEEEE", cameras: "1" }),
        row({ id: "20261007024507_FFFFF", speed: "190" }),
        row({ id: "not-an-id" }),
      ),
    );
    expect(meteors.map((m) => m.id)).toEqual(["20261007024503_BBBBB"]);
  });

  test("sorts oldest first", () => {
    const { meteors } = parseSummary(file(row({ id: "20261007030000_LATER", time: "2026-10-07 03:00:00.0" }), row({ id: "20261007020000_EARLY", time: "2026-10-07 02:00:00.0" })));
    expect(meteors.map((m) => m.id)).toEqual(["20261007020000_EARLY", "20261007030000_LATER"]);
  });

  test("refuses a file whose columns moved, instead of reading the wrong numbers", () => {
    const moved = ["#", header({ 67: "LatBeg", 63: "HtBeg" }), row()].join("\n\r");
    expect(() => parseSummary(moved)).toThrow(/changed its column layout/);
  });

  test("refuses a file with no usable meteors", () => {
    expect(() => parseSummary(file(row({ cameras: "1" })))).toThrow(/no usable meteors/);
  });
});

describe("summarise", () => {
  const parsed = parseSummary(
    file(
      row({ id: "20261007010000_EUBRI", time: "2026-10-07 01:00:00.0", shower: "STA", mag: "-3.0", speed: "30" }),
      row({ id: "20261007020000_EUFST", time: "2026-10-07 02:00:00.0", shower: "STA", mag: "0.5", speed: "71" }),
      row({ id: "20261007030000_USBIG", time: "2026-10-07 03:00:00.0", shower: "ORI", mag: "-9.0", speed: "66", latBeg: "34.7", lonBeg: "-105.5", latEnd: "34.8", lonEnd: "-105.6" }),
    ),
  );

  test("europe keeps only meteors that began over Europe, and counts the whole file", () => {
    const night = summarise(parsed, "europe");
    expect(night.total).toBe(3);
    expect(night.europe).toBe(2);
    expect(night.meteors.map((m) => m.id)).toEqual(["20261007010000_EUBRI", "20261007020000_EUFST"]);
    expect(night.brightest?.id).toBe("20261007010000_EUBRI");
    expect(night.fastest?.id).toBe("20261007020000_EUFST");
    expect(night.showers).toEqual([{ code: "STA", name: "Southern Taurids", count: 2 }]);
  });

  test("world includes everything and the camera codes stay on the server", () => {
    const night = summarise(parsed, "world");
    expect(night.meteors).toHaveLength(3);
    expect(night.brightest?.id).toBe("20261007030000_USBIG");
    expect(night.meteors.every((m) => !("stations" in m))).toBe(true);
    expect(night.from).toBeLessThan(night.to);
  });
});

describe("isEurope", () => {
  test("Rome and Brussels yes, New Mexico and Sydney no", () => {
    expect(isEurope(41.9, 12.5)).toBe(true);
    expect(isEurope(50.85, 4.35)).toBe(true);
    expect(isEurope(34.7, -105.5)).toBe(false);
    expect(isEurope(-33.9, 151.2)).toBe(false);
  });
});
