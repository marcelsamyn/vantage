import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { compassPoint } from "../../shared/geo";
import { useStationPasses } from "./usePasses";

const LEAD_MS = 5 * 60_000;

/** Tells you five minutes before a space station crosses your sky where you can see it. */
export default function PassWatcher(): null {
  const here = useLocation((s) => s.here);
  const { passes } = useStationPasses(here ? { lat: here.lat, lon: here.lon } : null, 24);
  const now = useNow(15_000);

  useEffect(() => {
    for (const p of passes) {
      const until = p.rise.getTime() - now;
      if (until > LEAD_MS || p.set.getTime() < now || !p.visible) continue;
      const entity = { kind: "satellite" as const, id: String(p.sat.ref.norad), data: p.sat.ref };
      feed(
        {
          level: "live",
          source: "satellites",
          title: until > 0 ? `${p.name} rises ${fmt.until(p.rise.getTime(), now)} in the ${compassPoint(p.riseAz)}` : `${p.name} is crossing your sky now`,
          detail: `Visible to the naked eye · peaks ${Math.round(p.peakEl)}° up in the ${compassPoint(p.peakAz)} at ${fmt.clock(p.peak.getTime())}`,
          entity,
          go: { screen: "sky", action: "show" },
        },
        { key: `satellites.pass.${p.sat.ref.norad}.${p.rise.getTime()}`, dedupeMs: 60 * 60_000, toast: true },
      );
    }
  }, [passes, now]);

  return null;
}
