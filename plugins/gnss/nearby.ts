import { RadioTower } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { inArea, type LatLon } from "../../shared/geo";
import { fetchJamming } from "./client";
import type { Jamming } from "./types";

/** One "here" item when aircraft over your spot reported poor navigation accuracy on the day gpsjam.org maps. */
export function jamItems(data: Jamming, at: LatLon): NearbyItem[] {
  const cell = data.cells.features.find((f) => inArea(at, f.geometry));
  if (!cell) return [];
  const { share, badAircraft, goodAircraft, level } = cell.properties;
  const total = badAircraft + goodAircraft;
  return [
    {
      id: "jamming",
      title: level === "heavy" ? "Heavy GPS interference over your area" : "GPS interference over your area",
      detail: `${share} % of aircraft (${badAircraft} of ${total}) reported poor accuracy on ${data.date}${data.suspect ? " · incomplete data" : ""}`,
      kind: "see",
      at: "here",
      icon: RadioTower,
      tone: level === "heavy" ? "alarm" : "sodium",
      primary: { label: "Show on map", run: () => import("../city/client").then((m) => m.showLayer("gnss.jamming")) },
    },
  ];
}

/** gpsjam.org publishes one map per UTC day, and the server keeps it for three hours. */
const nearby: NearbyProvider = async ({ at }, signal) => jamItems(await fetchJamming(signal), at);
export default nearby;
