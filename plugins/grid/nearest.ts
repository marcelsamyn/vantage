import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { loadTile, tileOf } from "./client";
import type { GridFeature, GridKind } from "./types";

const LABEL: Partial<Record<GridKind, string>> = { aed: "defibrillator", water: "drinking water", toilets: "public toilet", ev: "EV charger", hospital: "hospital", wifi: "public Wi-Fi" };

/** Find the nearest mapped object of a kind within the 3×3 grid tiles around you (about 6 km), then walk there. */
export async function findNearest(kind: GridKind): Promise<void> {
  const here = useLocation.getState().here;
  const label = LABEL[kind] ?? kind;
  if (!here) {
    feed({ level: "alert", source: "grid", title: `Finding a ${label} needs your location`, detail: "Allow location or pin a place first." }, { toast: true });
    return;
  }
  const c = tileOf(here);
  const tiles = await Promise.allSettled([-1, 0, 1].flatMap((dx) => [-1, 0, 1].map((dy) => loadTile(c.x + dx, c.y + dy))));
  let best: { f: GridFeature; d: number } | null = null;
  for (const t of tiles) {
    if (t.status !== "fulfilled") continue;
    for (const f of t.value.features) {
      if (f.properties.kind !== kind || f.geometry.type !== "Point") continue;
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const d = distanceM(here, { lat, lon });
      if (!best || d < best.d) best = { f, d };
    }
  }
  if (!best || best.f.geometry.type !== "Point") {
    feed({ level: "alert", source: "grid", title: `No ${label} mapped near you`, detail: "OpenStreetMap has none within about 3 km. Ask someone nearby." }, { toast: true });
    return;
  }
  const [lon, lat] = best.f.geometry.coordinates as [number, number];
  const name = best.f.properties.name ?? `Nearest ${label}`;
  profile.open({ kind: "grid", id: best.f.properties.osm, data: { ...best.f.properties, lat, lon } });
  feed({ level: "good", source: "grid", title: `${name}: ${fmt.distance(best.d, useSettings.getState().units)} away`, detail: "Walking route shown on the City map." });
  await routeTo({ lat, lon, name }, "foot");
}
