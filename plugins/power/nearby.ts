import { ZapOff } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, inArea, type LatLon } from "../../shared/geo";
import { fetchCuts } from "./client";
import type { PowerCut, PowerCuts } from "./types";

const SHOWN = 3;

/** A cut's area, when its outline is one. */
function inCutArea(at: LatLon, geometry: GeoJSON.Geometry): boolean {
  return (geometry.type === "Polygon" || geometry.type === "MultiPolygon") && inArea(at, geometry);
}

function detailOf(c: PowerCut): string {
  const who = c.customers ? `${c.customers} customers` : null;
  return [c.type === "planned" ? "Planned work" : "Power cut", c.statusText, who].filter(Boolean).join(" · ");
}

/** Open cuts on the Liander grid: the ones whose area holds your spot as a condition of your area, then those whose centre is inside the radius. */
export function cutItems(data: PowerCuts, at: LatLon, radiusM: number): NearbyItem[] {
  const shapes = new Map(data.areas.features.map((f) => [String(f.properties?.id ?? ""), f.geometry]));
  return data.cuts
    .filter((c) => c.status !== "fixed")
    .map((c) => {
      const shape = shapes.get(c.id);
      return { c, here: shape ? inCutArea(at, shape) : false, d: distanceM(at, c) };
    })
    .filter((x) => x.here || x.d <= radiusM)
    .sort((a, b) => Number(b.here) - Number(a.here) || a.d - b.d)
    .slice(0, SHOWN)
    .map(({ c, here }): NearbyItem => {
      const entity = { kind: "powercut", id: c.id, data: c } as const;
      return {
        id: c.id,
        title: c.streets[0] ? `${c.type === "planned" ? "Planned work" : "Power cut"} on ${c.streets[0]}${c.streets.length > 1 ? ` and ${c.streets.length - 1} more` : ""}` : c.type === "planned" ? "Planned power work" : "Power cut",
        detail: detailOf(c),
        kind: "see",
        at: here ? "here" : { lat: c.lat, lon: c.lon },
        icon: ZapOff,
        tone: c.type === "planned" ? "sodium" : "alarm",
        live: true,
        entity,
        primary: { label: "Details", run: () => profile.open(entity) },
      };
    });
}

/** Liander's feed, which the server refreshes every minute. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => cutItems(await fetchCuts(signal), at, radiusM);
export default nearby;
