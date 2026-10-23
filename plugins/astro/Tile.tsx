import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { Empty } from "../../app/ui";
import { moon, moonTimes, sun, sunTimes } from "./bodies";
import { MoonGlyph } from "./MoonGlyph";
import "./astro.css";

const W = 220;
const H = 92;

/** Briefing tile: today's arc of the Sun with where it is now, and tonight's Moon. */
export default function AstroTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const now = useNow(30_000);
  if (!here) return <Empty title="Location needed">Sun and Moon times depend on where you are.</Empty>;

  const date = new Date(now);
  const t = sunTimes(here.lat, here.lon, date);
  const m = moon(here.lat, here.lon, date);
  const mt = moonTimes(here.lat, here.lon, date);
  const s = sun(here.lat, here.lon, date);

  // Plot the Sun's elevation across the day: x = time of day, y = elevation.
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  const points = Array.from({ length: 49 }, (_, i) => {
    const d = new Date(midnight.getTime() + i * 30 * 60_000);
    const el = sun(here.lat, here.lon, d).el;
    return [(i / 48) * W, H / 2 - (el / 90) * (H / 2 - 4)] as const;
  });
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const nowX = ((now - midnight.getTime()) / 86_400_000) * W;
  const nowY = H / 2 - (s.el / 90) * (H / 2 - 4);

  return (
    <div className="astro-tile">
      <button type="button" className="astro-tile__sun" onClick={() => profile.open({ kind: "body", id: "sun", data: { body: "sun", name: "Sun" } })}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-label="The Sun's height across today">
          <defs>
            <clipPath id="astro-above">
              <rect x="0" y="0" width={W} height={H / 2} />
            </clipPath>
          </defs>
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} className="astro-horizon" />
          <path d={line} className="astro-path" />
          <path d={`${line}L${W},${H / 2}L0,${H / 2}Z`} className="astro-day" clipPath="url(#astro-above)" />
          <line x1={nowX} y1="2" x2={nowX} y2={H - 2} className="astro-now" />
          <circle cx={nowX} cy={nowY} r="5" className={s.el > 0 ? "astro-sun" : "astro-sun astro-sun--down"} />
        </svg>
        <div className="astro-times num">
          <span>
            <span className="faint">Rise </span>
            {t.sunrise ? fmt.clock(t.sunrise.getTime()) : "—"}
          </span>
          <span>
            <span className="faint">Golden </span>
            {t.goldenHour ? fmt.clock(t.goldenHour.getTime()) : "—"}
          </span>
          <span>
            <span className="faint">Set </span>
            {t.sunset ? fmt.clock(t.sunset.getTime()) : "—"}
          </span>
        </div>
      </button>
      <button type="button" className="astro-tile__moon" onClick={() => profile.open({ kind: "body", id: "moon", data: { body: "moon", name: "Moon" } })}>
        <MoonGlyph phase={m.phase} size={58} />
        <span className="astro-moon__name">{m.phaseName}</span>
        <span className="v-stat__hint">
          {Math.round(m.illumination * 100)}% lit · rises {mt.rise ? fmt.clock(mt.rise.getTime()) : "—"}
        </span>
      </button>
    </div>
  );
}
