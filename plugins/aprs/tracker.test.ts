import { expect, test } from "bun:test";
import { decodePacket } from "./decoder.server";
import { trackPacket } from "./tracker";
import type { AprsStation } from "./types";

function packet(body: string, at: number) {
  const decoded = decodePacket(`W1AW>APRS:${body}`, at);
  if (!decoded) throw new Error("Invalid test packet");
  return decoded;
}

test("positionless reports update last heard and telemetry without moving the station or erasing weather", () => {
  const stations = new Map<string, AprsStation>();
  trackPacket(stations, packet("!4903.50N/07201.75W_t050h60", 100));
  trackPacket(stations, packet("T#123,001,002,003,004,005,10101010", 200));
  const p = stations.get("station:W1AW");
  expect(p?.receivedAt).toBe(200);
  expect(p?.positionAt).toBe(100);
  expect(p?.lat).toBeCloseTo(49.058333);
  expect(p?.weather?.humidityPct).toBe(60);
  expect(p?.telemetry?.sequence).toBe(123);
  expect(p?.trail).toHaveLength(1);
});

test("kills remove objects; stale entries expire and trails and station memory are bounded", () => {
  const stations = new Map<string, AprsStation>();
  trackPacket(stations, packet(";RADIO    *110001z4903.50N/07201.75W-Test", 100));
  trackPacket(stations, packet(";RADIO    _110001z4903.50N/07201.75W-Test", 200));
  expect(stations.size).toBe(0);
  for (let i = 0; i < 40; i++) trackPacket(stations, packet(`!4903.${String(i).padStart(2, "0")}N/07201.75W-Test`, 1000 + i));
  expect(stations.get("station:W1AW")?.trail).toHaveLength(30);
  const p = packet("!4903.50N/07201.75W-Test", 3_600_000);
  trackPacket(stations, { ...p, id: "station:NEW", callsign: "NEW", name: "NEW" });
  expect(stations.has("station:W1AW")).toBe(false);
  for (let i = 0; i < 550; i++) trackPacket(stations, { ...p, id: `station:${i}`, callsign: String(i), name: String(i) });
  expect(stations.size).toBe(500);
});
