import type { Thing, ThingProvider, ThingRow } from "../../app/core/things";
import { osmId } from "../../shared/thing-ids";
import { fetchNasoni } from "./client";
import type { Nasone } from "./types";
import { overlapsRome } from "./rome";

/**
 * Rome's nasoni as drinking water. They are mapped in OpenStreetMap as `fountain=nasone`, which the street-grid
 * source does not ask for, so most of them are new; the ones tagged `amenity=drinking_water` as well arrive from
 * both surveys and land on one marker, because both carry the same OpenStreetMap reference.
 */

export function nasoneThings(fountains: readonly Nasone[]): Thing[] {
  return fountains.map((f): Thing => {
    const rows: ThingRow[] = [["Runs", "All day, all year"]];
    if (f.checked) rows.push(["Last surveyed", f.checked]);
    return {
      id: String(f.id),
      type: "water",
      name: null,
      label: "Nasone",
      at: { lat: f.lat, lon: f.lon },
      detail: "Cast-iron street fountain",
      match: [osmId(`node/${f.id}`)],
      rows,
      fact: "Rome keeps its nasoni running day and night: the water moves through the pipes instead of standing still in them.",
    };
  });
}

/** One request for the whole city, which the server keeps for a day, so panning around Rome costs nothing. */
const nasoni: ThingProvider = async ({ box }, emit, signal) => {
  if (!overlapsRome(box)) {
    emit([]);
    return;
  }
  const { fountains } = await fetchNasoni(signal);
  emit(nasoneThings(fountains).filter((t) => t.at.lat >= box.south && t.at.lat <= box.north && t.at.lon >= box.west && t.at.lon <= box.east));
};

export default nasoni;
