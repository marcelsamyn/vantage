import { z } from "zod";
import { fetchJson } from "../../server/kit";
import { sourceHealth, transitClock } from "./feeds.server";
import { RecordedSegments, Recording } from "./replay.server";
import { romeVehicles } from "./rome.server";
import { BASE } from "./transitous.server";

const count = z.coerce.number().int().min(2).max(60).parse(process.argv[3] ?? 12);
const output = process.argv[2] ?? "/private/tmp/vantage-rome-recording.json";
const started = transitClock.now();
const url = `${BASE}/map/trips?min=41.82,12.4&max=41.98,12.65&zoom=16&startTime=${new Date(started - 300_000).toISOString()}&endTime=${new Date(started + 300_000).toISOString()}`;
const segments = await fetchJson("Transitous recording", url, RecordedSegments);
const samples: z.infer<typeof Recording>["samples"] = [];
let selected: Set<string> | null = null;
for (let i = 0; i < count; i++) {
  const vehicles = await romeVehicles();
  if (!selected) selected = new Set(vehicles.filter(v => ["64", "105", "409"].includes(v.routeId)).slice(0, 16).map(v => v.vehicleId || v.label));
  const receivedAt = sourceHealth().find(s => s.source === "atac")?.receivedAt ?? transitClock.now();
  samples.push({ receivedAt, producedAt: vehicles[0]?.producedAt ?? null, vehicles: vehicles.filter(v => selected?.has(v.vehicleId || v.label)) });
  const routes = new Set(samples.flatMap(s => s.vehicles.map(v => v.routeId)));
  await Bun.write(output, JSON.stringify({ source: "ATAC / Roma Mobilita and Transitous", receiptClock: "Provider fetch completion on the VANTAGE monotonic clock; producedAt is the GTFS feed header when supplied", segments: segments.filter(s => s.mode !== "AIRPLANE" && s.trips.some(t => routes.has(t.routeShortName ?? ""))), samples } satisfies z.infer<typeof Recording>));
  console.log(`Saved sample ${i + 1}/${count}`);
  if (i + 1 < count) await new Promise<void>(resolve => setTimeout(resolve, 10_000));
}
