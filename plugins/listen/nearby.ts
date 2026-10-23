import { Mic } from "lucide-react";
import { api } from "../../app/core/api";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { distanceM } from "../../shared/geo";
import type { Microphone, Microphones } from "./types";

/** One item for a microphone; `project` is the project that runs it, named in the detail line. */
export function micItem(mic: Microphone, project: Microphones["sources"][number] | undefined): NearbyItem {
  return {
    id: mic.id,
    title: mic.name,
    detail: [mic.place, project?.name, "live sound"].filter(Boolean).join(" · "),
    kind: "do",
    at: { lat: mic.lat, lon: mic.lon },
    icon: Mic,
    tone: "sodium",
    live: true,
    primary: { label: "Listen", intent: { screen: "listen", action: "nearest" } },
    more: [{ label: "Project page", href: mic.homepage }],
  };
}

/** The nearest live microphone, when one is within reach. The list is the Listen screen's, cached for two minutes. */
const nearby: NearbyProvider = async ({ at, radiusM }, signal) => {
  // client.ts reaches the sound engine, which touches the window at import, so it loads here and not with the adapter above.
  const { nearestMic } = await import("./client");
  const { microphones, sources } = await api<Microphones>("/api/listen/mics", { signal });
  const mic = nearestMic(microphones, at);
  if (!mic || distanceM(at, mic) > radiusM) return [];
  return [micItem(mic, sources.find((s) => s.id === mic.source))];
};
export default nearby;
