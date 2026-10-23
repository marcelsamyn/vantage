import { describe, expect, test } from "bun:test";
import { decodeFeed } from "./gtfsrt";

// A minimal protobuf encoder, so the tests build the same bytes a feed would carry.
const varint = (n: bigint | number): number[] => {
  let v = BigInt.asUintN(64, BigInt(n));
  const out: number[] = [];
  do {
    const b = Number(v & 0x7fn);
    v >>= 7n;
    out.push(v > 0n ? b | 0x80 : b);
  } while (v > 0n);
  return out;
};
const tag = (field: number, wire: number): number[] => varint((field << 3) | wire);
const uint = (field: number, n: bigint | number): number[] => [...tag(field, 0), ...varint(n)];
const bytes = (field: number, payload: number[]): number[] => [...tag(field, 2), ...varint(payload.length), ...payload];
const str = (field: number, s: string): number[] => bytes(field, [...new TextEncoder().encode(s)]);
const float = (field: number, n: number): number[] => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, n, true);
  return [...tag(field, 5), ...b];
};
const entity = (id: string, ...parts: number[][]): number[] => bytes(2, [...str(1, id), ...parts.flat()]);
const feed = (timestamp: number, ...entities: number[][]): Uint8Array => new Uint8Array([...bytes(1, [...str(1, "2.0"), ...uint(3, timestamp)]), ...entities.flat()]);

describe("decodeFeed", () => {
  test("reads a vehicle with position, route, label and occupancy", () => {
    const trip = bytes(1, [...str(1, "0#1839-20"), ...str(2, "25:10:00"), ...str(3, "20261016"), ...str(5, "451")]);
    const position = bytes(2, [...float(1, 41.9028), ...float(2, 12.4964), ...float(3, 90)]);
    const vehicle = bytes(4, [...trip, ...position, ...uint(5, 1_791_492_544), ...str(7, "31120"), ...bytes(8, [...str(1, "9"), ...str(2, "0101")]), ...uint(9, 3)]);
    const out = decodeFeed(feed(1_791_492_600, entity("1", vehicle)));
    expect(out.timestamp).toBe(1_791_492_600);
    expect(out.vehicles).toHaveLength(1);
    const v = out.vehicles[0];
    expect(v?.tripId).toBe("0#1839-20");
    expect(v?.routeId).toBe("451");
    expect(v?.label).toBe("0101");
    expect(v?.vehicleId).toBe("9");
    expect(v?.serviceDate).toBe("20261016");
    expect(v?.startTime).toBe("25:10:00");
    expect(v?.lat).toBeCloseTo(41.9028, 4);
    expect(v?.lon).toBeCloseTo(12.4964, 4);
    expect(v?.bearing).toBe(90);
    expect(v?.timestamp).toBe(1_791_492_544);
    expect(v?.stopId).toBe("31120");
    expect(v?.occupancy).toBe("standing");
  });

  test("maps every occupancy code and ignores unreported ones", () => {
    const codes = [0, 1, 2, 3, 4, 5, 6, 7, 8];
    const entities = codes.map((c) => entity(String(c), bytes(4, [...bytes(2, [...float(1, 1), ...float(2, 2)]), ...uint(9, c)])));
    const got = decodeFeed(feed(1, ...entities)).vehicles.map((v) => v.occupancy);
    expect(got).toEqual(["empty", "many_seats", "few_seats", "standing", "crushed", "full", "closed", null, null]);
  });

  test("drops vehicles without a position", () => {
    const noPosition = entity("1", bytes(4, str(7, "x")));
    expect(decodeFeed(feed(1, noPosition)).vehicles).toHaveLength(0);
  });

  test("reads negative delays that arrive as 10-byte varints", () => {
    const stop = (id: string, delay: number): number[] => bytes(2, [...str(4, id), ...bytes(2, uint(1, BigInt(delay)))]);
    const update = bytes(3, [...bytes(1, [...str(1, "t1"), ...str(5, "64")]), ...stop("a", -100), ...stop("b", 34), ...stop("c", 0)]);
    const out = decodeFeed(feed(1, entity("1", update)));
    expect(out.tripUpdates[0]?.tripId).toBe("t1");
    expect(out.tripUpdates[0]?.stops.map((s) => [s.stopId, s.arrivalDelay])).toEqual([
      ["a", -100],
      ["b", 34],
      ["c", 0],
    ]);
  });

  test("skips fields it does not know, whatever their wire type, and deleted entities", () => {
    const unknown = [...uint(15, 7), ...tag(14, 1), 0, 0, 0, 0, 0, 0, 0, 0, ...float(13, 1), ...str(12, "ignored")];
    const vehicle = bytes(4, [...unknown, ...bytes(2, [...float(1, 10), ...float(2, 20), ...unknown])]);
    const deleted = bytes(2, [...str(1, "gone"), ...uint(2, 1), ...vehicle]);
    const out = decodeFeed(new Uint8Array([...feed(5, entity("kept", vehicle)), ...deleted]));
    expect(out.vehicles.map((v) => v.id)).toEqual(["kept"]);
  });

  test("rejects a truncated message instead of returning half of it", () => {
    const whole = feed(1, entity("1", bytes(4, bytes(2, [...float(1, 1), ...float(2, 2)]))));
    expect(() => decodeFeed(whole.slice(0, whole.length - 3))).toThrow();
  });

  test("decodes an empty feed", () => {
    expect(decodeFeed(new Uint8Array())).toEqual({ timestamp: 0, vehicles: [], tripUpdates: [] });
  });
});
