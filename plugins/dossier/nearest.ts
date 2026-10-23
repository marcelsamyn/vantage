import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { errorMessage } from "../../app/core/api";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { fetchNasoni } from "./client";
import { openSpot } from "./spot";

/** Beyond this, a nasone is not "nearby": you are probably not in Rome. */
const MAX_DISTANCE_M = 5000;

/** Find the nearest nasone to you, open its profile and show a walking route. */
export async function findNearestNasone(): Promise<void> {
  const here = useLocation.getState().here;
  if (!here) {
    feed({ level: "alert", source: "dossier", title: "Finding a nasone needs your location", detail: "Allow location or pin a place in Rome first." }, { toast: true });
    return;
  }
  try {
    const { fountains } = await fetchNasoni();
    let best: { id: number; lat: number; lon: number; d: number } | null = null;
    for (const f of fountains) {
      const d = distanceM(here, f);
      if (!best || d < best.d) best = { ...f, d };
    }
    if (!best || best.d > MAX_DISTANCE_M) {
      feed({ level: "alert", source: "dossier", title: "No nasone near you", detail: "Nasoni are Rome's drinking fountains. None is mapped within 5 km of your position." }, { toast: true });
      return;
    }
    openSpot({ id: `nasone/${best.id}`, name: "Nasone", kind: "fountain", context: "Drinking fountain, Rome", lat: best.lat, lon: best.lon });
    feed({ level: "good", source: "dossier", title: `Nearest nasone: ${fmt.distance(best.d, useSettings.getState().units)} away`, detail: "Walking route shown on the City map." });
    await routeTo({ lat: best.lat, lon: best.lon, name: "Nasone" }, "foot");
  } catch (err) {
    feed({ level: "alert", source: "dossier", title: "Could not look up the nasoni", detail: errorMessage(err) }, { toast: true });
  }
}
