import { Footprints } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { useBridges } from "./client";
import type { Bridge } from "./types";
import "./pulse.css";

const day = (ms: number): string => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

function statusText(b: Bridge, now: number): string {
  const n = b.now;
  if (!n) return "Closed to ships";
  if (n.phase === "window") return `Opening window running until ${n.until ? fmt.clock(n.until) : "further notice"}`;
  return `Reports itself open since ${day(n.from)} ${fmt.clock(n.from)}${now - n.from > 24 * 3_600_000 ? ", with no end announced" : ""}`;
}

/** One Dutch movable bridge: what it is doing now and its planned openings. */
export default function BridgeProfile({ entity, onClose }: ProfilerProps<"bridgeopening">): ReactElement {
  const { data } = useBridges();
  // The feed refreshes every few minutes; show its newest word on this bridge.
  const bridge = data?.bridges.find((b) => b.code === entity.data.bridge.code) ?? entity.data.bridge;
  const now = useNow(15_000);
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const next = bridge.upcoming[0];
  const name = bridge.name ?? `Bridge ${bridge.code}`;

  return (
    <ProfilerCard
      band="Movable bridge · live"
      tone={bridge.now ? "sodium" : "ice"}
      name={name}
      kicker={bridge.name ? `Netherlands · ${bridge.code}` : `Netherlands · name not in OpenStreetMap`}
      onClose={onClose}
      rows={[
        ["Now", statusText(bridge, now)],
        next && ["Next opening", `${fmt.until(next.from, now)} · ${fmt.clock(next.from)}${next.until ? `–${fmt.clock(next.until)}` : ""}`],
        ["Position", fmt.coord(bridge.lat, bridge.lon)],
        here && ["From you", `${fmt.distance(distanceM(here, bridge), units)} ${compassPoint(bearingDeg(here, bridge))}`],
      ]}
      fact="The national road data portal publishes openings as windows of about six minutes in which the bridge may open. A window is a plan, not a promise."
      actions={
        <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ lat: bridge.lat, lon: bridge.lon, name }, "foot")}>
          Walk here
        </Button>
      }
      source={`NDW open data (CC0) · schedule from ${data ? fmt.clock(data.publishedAt) : "…"} · name from OpenStreetMap`}
    >
      {bridge.upcoming.length > 0 && (
        <div className="pulse-schedule">
          <div className="v-eyebrow">Planned openings</div>
          <ul className="pulse-schedule__list">
            {bridge.upcoming.slice(0, 8).map((o) => (
              <li key={o.from} className="pulse-schedule__row num">
                <span>{fmt.clock(o.from)}</span>
                <span className="dim">{o.until ? `${Math.max(1, Math.round((o.until - o.from) / 60_000))} min` : ""}</span>
                <span className="pulse-schedule__when">{fmt.until(o.from, now)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ProfilerCard>
  );
}
