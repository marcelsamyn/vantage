import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { fetchBikes } from "./client";

/** Find the nearest station that has a bike right now, profile it, and walk there. */
export async function findBike(): Promise<void> {
  const here = useLocation.getState().here;
  if (!here) return;
  const data = await fetchBikes(here);
  const best = data.stations
    .filter((s) => s.renting && s.bikes > 0)
    .map((s) => ({ s, d: distanceM(here, s) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!best) {
    feed({ level: "alert", source: "bikes", title: "No bike available nearby", detail: data.networks.length ? "Every station within reach is empty." : "No bike-share network within 30 km." }, { toast: true });
    return;
  }
  const networkName = data.networks.find((n) => n.id === best.s.network)?.name ?? best.s.network;
  profile.open({ kind: "bikestation", id: best.s.id, data: { ...best.s, networkName } });
  feed({ level: "good", source: "bikes", title: `${best.s.bikes} bikes at ${best.s.name}`, detail: `${fmt.distance(best.d, useSettings.getState().units)} away · walking route on the map` });
  await routeTo({ lat: best.s.lat, lon: best.s.lon, name: best.s.name }, "foot");
}
