import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { Empty, Scanning, Stat, Tag } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import { lookFrom } from "./client";
import { useStationPasses } from "./usePasses";
import "./satellites.css";

const S = 120;
const R = S / 2 - 8;

/** Briefing tile: the next time a space station crosses your sky, drawn as its arc overhead. */
export default function PassTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const observer = here ? { lat: here.lat, lon: here.lon } : null;
  const { passes, ready, error } = useStationPasses(observer);
  const now = useNow(1000);
  if (!observer) return <Empty title="Location needed">Passes depend on where you are.</Empty>;
  if (error) return <Empty title="No orbital data" tone="error">{error.message}</Empty>;
  if (!ready) return <Scanning label="Computing orbits" />;

  const upcoming = passes.filter((p) => p.set.getTime() > now);
  const next = upcoming.find((p) => p.visible) ?? upcoming[0];
  if (!next) return <p className="dim">No station passes above 10° in the next three days.</p>;

  const steps = 24;
  const span = next.set.getTime() - next.rise.getTime();
  const pts = Array.from({ length: steps + 1 }, (_, i) => lookFrom(next.sat.rec, observer, new Date(next.rise.getTime() + (span * i) / steps)))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => {
      const r = ((90 - Math.max(0, p.el)) / 90) * R;
      const a = (p.az * Math.PI) / 180;
      return [S / 2 + r * Math.sin(a), S / 2 - r * Math.cos(a)] as const;
    });
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const inProgress = next.rise.getTime() <= now;

  return (
    <button type="button" className="satellites-tile" onClick={() => profile.open({ kind: "satellite", id: String(next.sat.ref.norad), data: next.sat.ref })}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} aria-hidden>
        <circle cx={S / 2} cy={S / 2} r={R} className="satellites-dome" />
        <circle cx={S / 2} cy={S / 2} r={R * (2 / 3)} className="satellites-dome satellites-dome--inner" />
        <text x={S / 2} y={7} className="satellites-dome__n">N</text>
        <path d={d} className="satellites-arc" />
        {pts[0] && <circle cx={pts[0][0]} cy={pts[0][1]} r="2.5" className="satellites-arc__start" />}
      </svg>
      <div className="satellites-tile__text">
        <Stat label={inProgress ? `${next.name} overhead now` : `Next ${next.name} pass`} value={inProgress ? "NOW" : fmt.until(next.rise.getTime(), now).replace("in ", "")} tone="ice" />
        <span className="v-stat__hint">
          {next.rise.toLocaleDateString("en-GB", { weekday: "long" })} {fmt.clock(next.rise.getTime())} · rises {compassPoint(next.riseAz)} · peaks {Math.round(next.peakEl)}°
        </span>
        <span>{next.visible ? <Tag tone="ice">Visible to the eye</Tag> : <Tag>Daylight or eclipsed</Tag>}</span>
      </div>
    </button>
  );
}
