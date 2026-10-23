import type { TransitAlert } from "./types";

const SEVERITY_RANK = { alarm: 0, sodium: 1, info: 2 } as const;

/** Worst first, then the newest. */
export const byImportance = (a: TransitAlert, b: TransitAlert): number => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || (b.from ?? 0) - (a.from ?? 0);

/** Lower-case letters and digits only, so the same notice from two sources compares equal. */
const fingerprint = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** Alerts from several sources as one list, worst first. A notice two sources both publish appears once. */
export function mergeAlerts(...lists: readonly (readonly TransitAlert[])[]): TransitAlert[] {
  const seen = new Set<string>();
  const out: TransitAlert[] = [];
  for (const a of lists.flat()) {
    const key = `${fingerprint(a.title)}|${fingerprint(a.text).slice(0, 120)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out.sort(byImportance);
}
