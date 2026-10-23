import { Bike } from "lucide-react";
import type { NearbyItem, NearbyProvider, NearbyTone } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchBikes } from "./client";
import type { BikeStation, BikesNear } from "./types";

/** Stations with a bike to take; one more with a free dock joins when none of those has one. */
const WITH_BIKES = 3;

/** The same colours as the bike layer: mint has bikes, sodium is nearly empty, alarm is empty. */
const toneOf = (s: BikeStation): NearbyTone => (s.bikes === 0 ? "alarm" : s.bikes <= 2 ? "sodium" : "mint");

function detailOf(s: BikeStation): string {
  const bikes = s.bikes === 0 ? "No bikes" : `${s.bikes} ${s.bikes === 1 ? "bike" : "bikes"}${s.ebikes ? ` (${s.ebikes} electric)` : ""}`;
  return s.docks === null ? bikes : `${bikes} · ${s.docks === 0 ? "no free docks" : `${s.docks} ${s.docks === 1 ? "dock" : "docks"}`}`;
}

/** The nearest stations to rent from, and the nearest free dock if those are full. */
export function bikeItems(data: BikesNear, at: LatLon, radiusM: number): NearbyItem[] {
  const names = new Map(data.networks.map((n) => [n.id, n.name]));
  const open = data.stations
    .filter((s) => s.renting)
    .map((s) => ({ s, d: distanceM(at, s) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.s);
  const picked = open.filter((s) => s.bikes > 0).slice(0, WITH_BIKES);
  const dock = open.find((s) => (s.docks ?? 0) > 0);
  if (dock && !picked.some((s) => (s.docks ?? 0) > 0)) picked.push(dock);
  return picked.map((s): NearbyItem => {
    const entity = { kind: "bikestation", id: s.id, data: { ...s, networkName: names.get(s.network) ?? s.network } } as const;
    return {
      id: `${s.network}:${s.id}`,
      title: s.name || "Bike station",
      detail: detailOf(s),
      kind: "go",
      at: { lat: s.lat, lon: s.lon },
      icon: Bike,
      tone: toneOf(s),
      entity,
      primary: { label: "Show bikes", run: () => profile.open(entity) },
      more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: s.lat, lon: s.lon, name: s.name }, "foot")) }],
    };
  });
}

const nearby: NearbyProvider = async ({ at, radiusM }, signal) => bikeItems(await fetchBikes(at, signal), at, radiusM);
export default nearby;
