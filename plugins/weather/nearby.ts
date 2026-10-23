import { TriangleAlert } from "lucide-react";
import type { Action } from "../../app/core/action";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { fetchWarnings, LEVEL_WORDS, warningsHere } from "./client";
import type { OfficialWarning } from "./types";

/** The two strongest warnings of a list that is already sorted strongest first. */
export function warningItems(warnings: readonly OfficialWarning[]): NearbyItem[] {
  return warnings.slice(0, 2).map((w): NearbyItem => {
    const entity = { kind: "warning", id: w.id, data: w } as const;
    const more: Action[] = w.url ? [{ label: "Official notice", href: w.url }] : [];
    return {
      id: w.id,
      title: `${LEVEL_WORDS[w.level]} warning: ${w.hazard}`,
      detail: `${w.area} · ${w.issuer}`,
      kind: "see",
      at: "here",
      icon: TriangleAlert,
      tone: w.level === "yellow" ? "sodium" : "alarm",
      startsAt: w.from * 1000,
      until: w.until * 1000,
      entity,
      primary: { label: "What to do", run: () => profile.open(entity) },
      more,
    };
  });
}

/** The official weather warnings for the spot you stand on, strongest first. The server refreshes its feeds every ten minutes. */
const nearby: NearbyProvider = async ({ at }, signal) => warningItems(warningsHere(await fetchWarnings(at, signal)));
export default nearby;
