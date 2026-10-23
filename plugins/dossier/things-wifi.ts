import { fmt } from "../../app/core/format";
import type { Thing, ThingProvider, ThingRow } from "../../app/core/things";
import { fetchWifiDay } from "./client";
import { overlapsRome } from "./rome";
import type { WifiDay, WifiHotspot } from "./types";
import { languageMix } from "./wifi-format";

/**
 * Rome's own public Wi-Fi hotspots, with what the city logged on the day it last published: how many sessions,
 * how much data, and the mix of interface languages. Totals per hotspot, never single sessions.
 */

/** The day the sources last read, so a profile section can show more of a hotspot than its rows hold. */
let day: WifiDay | null = null;

/** One hotspot as the city published it, for a section that wants its numbers rather than its rows. */
export function hotspotById(id: string): { hotspot: WifiHotspot; date: string } | null {
  const hotspot = day?.hotspots.find((h) => h.id === id);
  return day && hotspot ? { hotspot, date: day.date } : null;
}

export function hotspotThings(data: WifiDay): Thing[] {
  return data.hotspots.map((h): Thing => {
    const rows: ThingRow[] = [
      ["Sessions", `${fmt.int(h.sessions)} on ${data.date}`],
      ["Data", fmt.bytes(h.bytes)],
    ];
    if (h.sessions > 0) rows.push(["Per session", fmt.bytes(h.bytes / h.sessions)]);
    if (h.languages.length > 0) rows.push(["Language", languageMix(h.languages)]);
    if (h.venue) rows.push(["Address", h.address]);
    rows.push(["District", h.municipio]);
    return {
      id: h.id,
      type: "wifi",
      // The site is the hotspot's own name, which another survey of the same library or office can confirm.
      name: h.venue,
      label: h.address,
      at: { lat: h.lat, lon: h.lon },
      // The city keys its hotspots by their address, which no other register shares.
      match: [],
      detail: `${fmt.int(h.sessions)} sessions on ${data.date}`,
      rows,
      fact: "Rome logs each public Wi-Fi session's language and data volume. VANTAGE sums them per hotspot for the day.",
    };
  });
}

const wifi: ThingProvider = async ({ box }, emit, signal) => {
  if (!overlapsRome(box)) {
    emit([]);
    return;
  }
  day = await fetchWifiDay(signal);
  emit(hotspotThings(day).filter((t) => t.at.lat >= box.south && t.at.lat <= box.north && t.at.lon >= box.west && t.at.lon <= box.east));
};

export default wifi;
