import { expect, test } from "bun:test";
import { decodePacket, packetTime } from "./decoder.server";

const now = Date.UTC(2026, 9, 11, 0, 1);

test("decodes a real position with weather and keeps the route and raw packet", () => {
  const raw = "FW7233>APRS,TCPXX*,qAX,CWOP-2:@231821z5150.13N/01913.68E_239/003g010t042r000p011P011b09969h83L000eMB51";
  const p = decodePacket(raw, now);
  expect(p).toMatchObject({ callsign: "FW7233", lat: 51.8355, lon: 19.228, symbol: "/_", raw, receivedAt: now });
  expect(p?.weather).toMatchObject({ temperatureC: 5.555555555555555, humidityPct: 83, pressureHpa: 996.9 });
});

test("coordinates keep south and west hemispheres, malformed coordinates do not become map points", () => {
  expect(decodePacket("VK3ABC>APRS:!3351.00S/15112.00W-Test", now)).toMatchObject({ lat: -33.85, lon: -151.2 });
  for (const pos of ["9160.00N/18100.00E-", "4903.50X/07201.75W-", "4903.50N/07261.75W-", "missing"]) {
    expect(decodePacket(`W1AW>APRS:!${pos}`, now)?.lat).toBeNull();
  }
});

test("decodes compressed coordinates from the protocol reference", () => {
  expect(decodePacket("W1AW>APRS:!/5L!!<*e7>7P[comment", now)).toMatchObject({ symbol: "/>" });
  const p = decodePacket("W1AW>APRS:!/5L!!<*e7>7P[comment", now);
  expect(p?.lat).toBeCloseTo(49.5, 3);
  expect(p?.lon).toBeCloseTo(-72.75, 3);
});

test("objects and items retain their names and killed records remove the same id", () => {
  const live = decodePacket("W1AW>APRS:;RADIO    *110001z4903.50N/07201.75W-Test", now);
  const killed = decodePacket("W1AW>APRS:;RADIO    _110001z4903.50N/07201.75W-Test", now);
  expect(live).toMatchObject({ name: "RADIO", kind: "object", alive: true });
  expect(killed).toMatchObject({ id: live?.id, alive: false });
  expect(decodePacket("W1AW>APRS:)Repeater!4903.50N/07201.75W-Test", now)).toMatchObject({ name: "Repeater", kind: "item", alive: true });
});

test("decodes a known Mic-E packet", () => {
  const p = decodePacket('SQ7PFS-10>S32U6T,TCPIP*,qAC,T2SYDNEY:`(_fn"Oj/>Hellov', now);
  expect(p?.lat).toBeCloseTo(33.4273333333, 7);
  expect(p?.lon).toBeCloseTo(-12.129, 7);
});

test("status and telemetry have no invented coordinates", () => {
  expect(decodePacket("W1AW>APRS:>Testing radio", now)).toMatchObject({ lat: null, lon: null, status: "Testing radio" });
  expect(decodePacket("W1AW>APRS:T#123,001,002,003,004,005,10101010", now)?.telemetry).toEqual({ sequence: 123, analog: [1, 2, 3, 4, 5], digital: "10101010" });
});

test("timestamps choose the nearest valid UTC day or month; local timestamps stay unspecified", () => {
  expect(packetTime("312359z", Date.UTC(2026, 10, 1, 0, 1))).toBe(Date.UTC(2026, 9, 31, 23, 59));
  expect(packetTime("235900h", now)).toBe(Date.UTC(2026, 9, 10, 23, 59));
  expect(packetTime("110001/", now)).toBeNull();
  expect(packetTime("996199z", now)).toBeNull();
});
