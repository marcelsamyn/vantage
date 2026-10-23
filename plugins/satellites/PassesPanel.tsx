import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import { Empty, Scanning, Tag } from "../../app/ui";
import { compassPoint, type LatLon } from "../../shared/geo";
import { useStationPasses } from "./usePasses";
import "./satellites.css";

/** Sky screen panel: the next passes of the crewed stations, with the visible ones marked. */
export default function PassesPanel({ observer }: { observer: LatLon }): ReactElement {
  const { passes, ready, error } = useStationPasses(observer);
  const now = useNow(30_000);
  if (error) return <Empty title="No orbital data" tone="error">{error.message}</Empty>;
  if (!ready) return <Scanning label="Computing orbits" />;
  if (passes.length === 0) return <p className="dim">No station rises more than 10° above your horizon in the next three days.</p>;
  return (
    <ul className="satellites-passes">
      {passes.slice(0, 8).map((p) => (
        <li key={`${p.sat.ref.norad}-${p.rise.getTime()}`}>
          <button type="button" className="satellites-pass" onClick={() => profile.open({ kind: "satellite", id: String(p.sat.ref.norad), data: p.sat.ref })}>
            <span className="satellites-pass__name">{p.name}</span>
            <span className="satellites-pass__when num">
              {p.rise.toLocaleDateString("en-GB", { weekday: "short" })} {fmt.clock(p.rise.getTime())}
              <span className="faint"> {fmt.until(p.rise.getTime(), now)}</span>
            </span>
            <span className="satellites-pass__path num">
              {compassPoint(p.riseAz)} → {Math.round(p.peakEl)}° → {compassPoint(p.setAz)}
            </span>
            {p.visible ? <Tag tone="ice">Visible</Tag> : <Tag>Not visible</Tag>}
          </button>
        </li>
      ))}
    </ul>
  );
}
