import { useEffect, useRef } from "react";
import { feed } from "../../app/core/feed";
import { useSettings } from "../../app/core/settings";
import { complexName, useDsn } from "./client";
import { farthestLink, linkClause, signalLeftSentence } from "./links";
import type { DsnLink } from "./types";

const VOYAGERS = new Set([-31, -32]);
/** A link unseen this long counts as ended; the next time it appears is a new pass. */
const PASS_GAP_MS = 30 * 60_000;
/** The "farthest" announcement is for spacecraft well beyond Earth's neighbourhood (about five Moon distances). */
const FAR_KM = 2_000_000;

/** Raises a feed event when a dish begins a pass with a Voyager, or with the farthest spacecraft on air. */
export default function DeepspaceWatcher(): null {
  const dsn = useDsn();
  const units = useSettings((s) => s.units);
  const lastSeen = useRef(new Map<string, number>());

  useEffect(() => {
    const snapshot = dsn.data;
    if (!snapshot) return;
    const now = Date.now();
    const far = farthestLink(snapshot.links);
    const interesting: DsnLink[] = snapshot.links.filter((l) => VOYAGERS.has(l.spacecraft.naifId) || (l === far && (l.distanceKm ?? 0) > FAR_KM));

    for (const link of interesting) {
      const seen = lastSeen.current.get(link.key);
      lastSeen.current.set(link.key, now);
      if (seen !== undefined && now - seen < PASS_GAP_MS) continue;
      const name = complexName(snapshot, link.complexId);
      feed(
        {
          level: "live",
          source: "deepspace",
          title: `${name} is on air with ${link.spacecraft.name}`,
          detail: [linkClause(link, name, units), signalLeftSentence(link)].filter(Boolean).join(" "),
          go: { screen: "deepspace", action: "orrery" },
          entity: { kind: "spacecraft", id: String(link.spacecraft.naifId), data: link.spacecraft },
        },
        { key: `deepspace:${link.key}:${now}` },
      );
    }
  }, [dsn.data, units]);

  return null;
}
