import type { Action } from "../../app/core/action";
import { fmt } from "../../app/core/format";
import type { Thing, ThingProvider, ThingRow, ThingState } from "../../app/core/things";
import { distanceM } from "../../shared/geo";
import { fetchFreeVehicles } from "./client";
import type { FreeVehicle } from "./types";

/**
 * Scooters, mopeds and bikes you can unlock where they stand, from the operators who publish an open GBFS feed.
 * A vehicle whose feed carries a rental link offers it: the action goes back to the operator, who does the renting.
 */

const PROPULSION: Record<string, string> = {
  electric: "Electric",
  electric_assist: "Electric-assist",
  human: "Pedal power",
  combustion: "Petrol",
  combustion_diesel: "Diesel",
  hybrid: "Hybrid",
  plug_in_hybrid: "Plug-in hybrid",
  hydrogen_fuel_cell: "Hydrogen",
};

/** The mark a vehicle wears: its form factor, as the operators report it. */
const VARIANT: Record<string, string> = {
  bicycle: "bike",
  cargo_bicycle: "bike",
  scooter: "scooter",
  scooter_standing: "scooter",
  scooter_seated: "moped",
  moped: "moped",
  car: "car",
};

/** Battery, where the operator reports it: under 15 % is nearly flat, under 40 % is low. */
function stateOf(charge: number | null): ThingState {
  if (charge === null) return "unknown";
  if (charge < 0.15) return "out";
  if (charge < 0.4) return "low";
  return "ok";
}

/** Exported on its own, so a test can feed it a recorded answer. */
export function vehicleThings(vehicles: readonly FreeVehicle[]): Thing[] {
  return vehicles.map((v): Thing => {
    const charge = v.charge === null ? null : Math.round(v.charge * 100);
    const rows: ThingRow[] = [
      ["Operator", v.operator ?? v.systemName],
      ["Type", [v.typeName, v.formName].filter(Boolean).join(" · ")],
    ];
    if (v.propulsion) rows.push(["Drive", PROPULSION[v.propulsion] ?? v.propulsion]);
    if (charge !== null) rows.push(["Battery", `${charge}%`]);
    if (v.rangeM !== null) rows.push(["Range left", `${fmt.one(v.rangeM / 1000)} km`]);
    // Some operators report a current range above their type's nominal range; only the plausible pair is shown.
    if (v.maxRangeKm !== null && (v.rangeM === null || v.rangeM / 1000 <= v.maxRangeKm)) rows.push(["Range when full", `${fmt.one(v.maxRangeKm)} km`]);
    const actions: Action[] = v.rentalUrl ? [{ label: "Rent now", href: v.rentalUrl }] : [];
    return {
      id: v.id,
      type: "scooter",
      name: null,
      label: charge === null ? v.formName : `${v.formName}, ${charge}% charged`,
      at: { lat: v.lat, lon: v.lon },
      // "<system>~<vehicle>": the same vehicle in a second feed of the same system.
      match: [`gbfs:${v.id}`],
      detail: v.operator ?? v.systemName,
      state: stateOf(v.charge),
      variant: VARIANT[v.form] ?? "scooter",
      rows,
      actions,
      fact: "This map shows what the operator lists as free to take: reserved and disabled vehicles are left out.",
    };
  });
}

/** The view's half-width in kilometres, rounded up so a small pan reuses the same request. The server caps it at 25 km. */
const radiusKm = (box: { west: number; east: number }, center: { lat: number; lon: number }): number =>
  Math.min(25, Math.max(1, Math.ceil((distanceM(center, { lat: center.lat, lon: box.east }) / 1000) * 1.2)));

const scooters: ThingProvider = async ({ box, center }, emit, signal) => {
  const data = await fetchFreeVehicles(center, radiusKm(box, center), signal);
  emit(vehicleThings(data.vehicles));
  // Every operator that serves the area failed: say so rather than claim the street is empty.
  const broken = data.systems.filter((s) => !s.ok);
  if (data.vehicles.length === 0 && broken.length > 0 && broken.length === data.systems.length) {
    throw new Error(broken.map((s) => `${s.name}: ${s.error}`).join("; "));
  }
};

export default scooters;
