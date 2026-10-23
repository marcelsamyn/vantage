import type { NearbyKind, PlacedItem } from "../../app/core/nearby";

export type AroundTab = "all" | "now" | NearbyKind;

export const AROUND_TABS: readonly { value: AroundTab; label: string }[] = [
  { value: "all", label: "Everything" },
  { value: "now", label: "Now" },
  { value: "go", label: "Go" },
  { value: "find", label: "Find" },
  { value: "do", label: "Do" },
  { value: "see", label: "See" },
];

export function aroundTab(value: unknown): AroundTab {
  return AROUND_TABS.find((tab) => tab.value === value)?.value ?? "all";
}

/** The list and map share the same category filter. */
export function aroundItems(items: readonly PlacedItem[], tab: AroundTab, expanded: boolean): PlacedItem[] {
  if (tab === "all") return [...items];
  const matching = items.filter((item) => {
    if (tab !== "now") return item.kind === tab;
    // Routine readings belong in See; a sensor warning also belongs in Now.
    if (item.source.startsWith("sensors.") && item.tone !== "sodium" && item.tone !== "alarm") return false;
    return item.urgency !== "none";
  });
  if (tab !== "now" || expanded) return matching;

  const counts = new Map<string, number>();
  const shown: PlacedItem[] = [];
  for (const item of matching) {
    const count = counts.get(item.source) ?? 0;
    if (count >= 2) continue;
    shown.push(item);
    counts.set(item.source, count + 1);
    if (shown.length === 6) break;
  }
  return shown;
}
