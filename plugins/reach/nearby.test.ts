import { describe, expect, test } from "bun:test";
import { boxAround, noteItems, orderItems, receiverItems, stationItems } from "./nearby";
import type { GroundStation, MapNote, Receiver, WorkOrder } from "./types";

// Things around Place Flagey in Brussels, shaped like the /api/reach answers of 9 October 2026.
const AT = { lat: 50.8275, lon: 4.3722 };
const T = Date.UTC(2026, 9, 9, 9, 0);

const kiwi: Receiver = { kind: "kiwisdr", id: "kiwi-be-1", name: "ON4KST Ixelles", lat: 50.8301, lon: 4.3695, place: "Ixelles, Brussels", antenna: "Magnetic loop", minHz: 10_000, maxHz: 30_000_000, users: 2, slots: 8, url: "http://example.invalid:8073" };
const fullKiwi: Receiver = { ...kiwi, id: "kiwi-be-2", name: "Full house", lat: 50.8276, lon: 4.3723, users: 4, slots: 4 };
const noLimit: Receiver = { ...kiwi, id: "websdr-be", kind: "websdr", name: "WebSDR Brussels", lat: 50.8251, lon: 4.3801, place: null, users: null, slots: null };

const station: GroundStation = { id: 2041, name: "Etterbeek Roof", lat: 50.8349, lon: 4.3871, altitudeM: 60, status: "online", antennas: ["UHF · Cross Yagi", "VHF · Turnstile"], observations: 12874, scheduled: 3, successRate: 82, lastSeen: T - 60_000, owner: "VUB Space Club", observing: null };

const note: MapNote = { id: 4412345, lat: 50.8281, lon: 4.3699, status: "open", createdAt: T - 86_400_000, comments: [{ at: T - 86_400_000, action: "opened", text: "The bench on the east side of the pond\nis gone.\n  Please check." }], url: "https://www.openstreetmap.org/note/4412345" };

const order: WorkOrder = { id: "18273645", operator: "FixMyStreet", authority: "Brussels", category: "Pothole", status: "open", createdAt: T - 3_600_000, description: null, photo: "https://example.invalid/p.jpg", lat: 50.8268, lon: 4.3731, url: "https://www.fixmystreet.brussels/report/18273645" };

describe("receiverItems", () => {
  test("lists free receivers to tune, with place, band and seats, nearest first", () => {
    const items = receiverItems([noLimit, fullKiwi, kiwi], AT, 2000);
    expect(items.map((i) => i.title)).toEqual(["ON4KST Ixelles", "WebSDR Brussels"]);
    expect(items[0]).toMatchObject({ kind: "do", tone: "sodium", detail: "Ixelles, Brussels · 10 kHz – 30 MHz · 2 of 8 slots in use" });
    expect(items[0]?.primary.label).toBe("Tune in");
    expect(items[0]?.entity).toMatchObject({ kind: "receiver", id: "kiwi-be-1" });
    expect(items[1]?.detail).toBe("10 kHz – 30 MHz · No seat limit");
  });

  test("nothing when every receiver nearby is full or none is within the radius", () => {
    expect(receiverItems([fullKiwi], AT, 2000)).toEqual([]);
    expect(receiverItems([kiwi], AT, 200)).toEqual([]);
  });

  test("keeps the nearest three", () => {
    const row = Array.from({ length: 5 }, (_, i): Receiver => ({ ...kiwi, id: `k${i}`, lat: 50.8275 + i * 0.001 }));
    expect(receiverItems(row, AT, 5000).map((i) => i.id)).toEqual(["k0", "k1", "k2"]);
  });
});

describe("noteItems", () => {
  test("shows an open note's first message on one line", () => {
    const [item] = noteItems([note], AT, 2000);
    expect(item).toMatchObject({ id: "4412345", title: "Map note 4412345", kind: "do", detail: "The bench on the east side of the pond is gone. Please check." });
    expect(item?.more).toEqual([{ label: "On OpenStreetMap", href: note.url }]);
  });

  test("cuts a long message and names a note without text", () => {
    const long = { ...note, comments: [{ ...(note.comments[0] as MapNote["comments"][number]), text: "x".repeat(200) }] };
    expect(noteItems([long], AT, 2000)[0]?.detail).toHaveLength(90);
    expect(noteItems([{ ...note, comments: [] }], AT, 2000)[0]?.detail).toBe("Open note without text");
  });

  test("skips a closed note and one beyond the radius", () => {
    expect(noteItems([{ ...note, status: "closed" }, { ...note, id: 2, lat: 50.9 }], AT, 2000)).toEqual([]);
  });
});

describe("stationItems", () => {
  test("describes an idle station by its antennas and record", () => {
    expect(stationItems([station], AT, 3000)[0]).toMatchObject({ kind: "see", tone: "mint", detail: "UHF · Cross Yagi + VHF · Turnstile · 12,874 passes recorded" });
    expect(stationItems([station], AT, 3000)[0]?.live).toBeUndefined();
  });

  test("a station recording a pass is live until the pass ends", () => {
    const busy = { ...station, observing: { satellite: "NOAA 19", endsAt: T + 600_000 } };
    expect(stationItems([busy], AT, 3000)[0]).toMatchObject({ tone: "sodium", live: true, until: T + 600_000, detail: "Recording NOAA 19" });
  });

  test("skips a station that is only testing, and one out of range", () => {
    expect(stationItems([{ ...station, status: "testing" }], AT, 3000)).toEqual([]);
    expect(stationItems([station], AT, 1000)).toEqual([]);
  });
});

describe("orderItems", () => {
  test("lists open reports with their status, authority and photo", () => {
    const [item] = orderItems([order], AT, 2000);
    expect(item).toMatchObject({ id: "FixMyStreet:18273645", title: "Pothole", detail: "Open · Brussels", image: "https://example.invalid/p.jpg", kind: "see" });
    expect(item?.more).toEqual([{ label: "Open report", href: order.url }]);
  });

  test("falls back to the operator and adds the description when there is one", () => {
    const [item] = orderItems([{ ...order, authority: null, status: "acknowledged", description: "Deep hole by the tram stop", photo: null }], AT, 2000);
    expect(item?.detail).toBe("Acknowledged · FixMyStreet · Deep hole by the tram stop");
    expect(item?.image).toBeUndefined();
  });

  test("returns nothing when no report is in range", () => {
    expect(orderItems([], AT, 2000)).toEqual([]);
    expect(orderItems([order], AT, 50)).toEqual([]);
  });
});

describe("boxAround", () => {
  test("surrounds the position by the radius", () => {
    const box = boxAround(AT, 1000);
    expect(box.north - AT.lat).toBeCloseTo(0.009, 3);
    expect(AT.lon - box.west).toBeCloseTo(box.east - AT.lon, 5);
  });
});
