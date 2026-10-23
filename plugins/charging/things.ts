import type { Thing, ThingProvider, ThingRow, ThingState } from "../../app/core/things";
import { fetchCharging } from "./client";
import type { ChargingAvailability, ChargingStation } from "./types";

export function availabilityState(data: ChargingAvailability | null): ThingState {
  if (!data || !data.connectors.length) return "unknown";
  const count = data.connectors.reduce((sum, c) => ({ available: sum.available + c.availability.current.available, occupied: sum.occupied + c.availability.current.occupied,
    reserved: sum.reserved + c.availability.current.reserved, unknown: sum.unknown + c.availability.current.unknown, outOfService: sum.outOfService + c.availability.current.outOfService }),
  { available: 0, occupied: 0, reserved: 0, unknown: 0, outOfService: 0 });
  if (count.available > 0) return "ok";
  if (count.unknown > 0) return "unknown";
  if (count.occupied + count.reserved > 0) return "low";
  return count.outOfService > 0 ? "out" : "unknown";
}

export function stationThing(station: ChargingStation, capped: boolean): Thing {
  const rows: ThingRow[] = [];
  if (station.address) rows.push(["Address", station.address]);
  if (station.brands.length) rows.push(["Operator", station.brands.join(", ")]);
  if (station.phone) rows.push(["Phone", station.phone]);
  if (station.availabilityError) rows.push(["Availability", station.availabilityError]);
  else if (!station.availabilityId || !station.availability?.connectors.length) rows.push(["Availability", "Live availability is not reported for this station."]);
  for (const c of station.availability?.connectors ?? []) {
    const n = c.availability.current;
    rows.push([c.type, `${n.available} available · ${n.occupied} occupied · ${n.reserved} reserved · ${n.outOfService} out of service · ${n.unknown} unknown · ${c.total} total`]);
    for (const p of c.availability.perPowerLevel) rows.push([`${c.type} · ${p.powerKW} kW`, `${p.available} available · ${p.occupied} occupied · ${p.reserved} reserved · ${p.outOfService} out of service · ${p.unknown} unknown`]);
  }
  for (const c of station.connectors) rows.push(["Connector", [c.connectorType, c.ratedPowerKW !== undefined ? `${c.ratedPowerKW} kW` : null, c.currentType, c.currentA !== undefined ? `${c.currentA} A` : null, c.voltageV !== undefined ? `${c.voltageV} V` : null].filter(Boolean).join(" · ")]);
  if (station.checkedAt !== null) rows.push(["Checked", new Date(station.checkedAt).toLocaleString()]);
  if (capped) rows.push(["Coverage", "The nearest 20 TomTom stations in this view. Zoom in to see more stations."]);
  const available = station.availability?.connectors.length ? station.availability.connectors.reduce((sum, c) => sum + c.availability.current.available, 0) : undefined;
  return { id: station.id, type: "ev", name: station.name, at: { lat: station.lat, lon: station.lon },
    match: [`tomtom:${station.id}`, ...(station.availabilityId ? [`tomtom-charging:${station.availabilityId}` as const] : [])],
    detail: station.availabilityError ? "Availability could not load" : available === undefined ? "Availability not reported" : `${available} connectors available`,
    state: availabilityState(station.availability), rows, actions: station.website ? [{ label: "Open operator website", href: station.website }] : [],
  };
}
const provide: ThingProvider = async (query, emit, signal) => { const result = await fetchCharging(query.box, signal); emit(result.stations.map((s) => stationThing(s, result.capped))); };
export default provide;
