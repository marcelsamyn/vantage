import type { AprsPacket, AprsStation } from "./types";

export const STALE_MS = 30 * 60_000;

export function pruneStations(stations: Map<string, AprsStation>, now: number): void {
  for (const [id, p] of stations) if (now - p.receivedAt > STALE_MS) stations.delete(id);
}

export function trackPacket(stations: Map<string, AprsStation>, packet: AprsPacket): void {
  pruneStations(stations, packet.receivedAt);
  if (!packet.alive) { stations.delete(packet.id); return; }
  const previous = stations.get(packet.id);
  const positioned = packet.lat !== null && packet.lon !== null;
  if (!positioned && !previous) return;
  const trail = previous?.trail.slice() ?? [];
  if (positioned) {
    const last = trail.at(-1);
    if (!last || last[0] !== packet.lon || last[1] !== packet.lat) trail.push([packet.lon!, packet.lat!]);
  }
  const station: AprsStation = {
    ...packet,
    lat: positioned ? packet.lat : previous!.lat,
    lon: positioned ? packet.lon : previous!.lon,
    symbol: packet.symbol ?? previous?.symbol ?? null,
    comment: positioned ? packet.comment : previous?.comment ?? packet.comment,
    reportedAt: packet.reportedAt,
    timestamp: packet.timestamp,
    altitudeM: packet.altitudeM ?? previous?.altitudeM ?? null,
    courseDeg: packet.courseDeg ?? previous?.courseDeg ?? null,
    speedKt: packet.speedKt ?? previous?.speedKt ?? null,
    status: packet.status ?? previous?.status ?? null,
    weather: packet.weather ?? previous?.weather ?? null,
    telemetry: packet.telemetry ?? previous?.telemetry ?? null,
    positionAt: positioned ? packet.receivedAt : previous!.positionAt,
    trail: trail.slice(-30),
  };
  // Map insertion order is last-heard order, so overflow drops the least recently heard station.
  stations.delete(packet.id);
  stations.set(packet.id, station);
  if (stations.size > 500) stations.delete(stations.keys().next().value!);
}
