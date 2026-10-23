import { motion } from "motion/react";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning, Stat } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { shieldsStatus } from "./status";
import { activityWords, auroraRgba, decodeGrid, fetchAuroraGrid, isDark, peakAhead, sampleField, sunElevation, useReach, useSpaceWx, type AuroraField, type Reach } from "./client";
import type { AuroraPoint } from "./types";
import "./spacewx.css";

const SIZE = 112;
const PIXELS = SIZE * 2;

/** Briefing tile: how far south the aurora reaches tonight, your own chance, and Kp, with the oval drawn around your pole. */
export default function SpaceWxTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const aurora = useSpaceWx((s) => s.aurora);
  const now = useSpaceWx((s) => s.now);
  const error = useSpaceWx((s) => s.error);
  const grid = usePoll((signal) => fetchAuroraGrid(signal), 10 * 60_000, []);
  const field = useMemo(() => (grid.data ? decodeGrid(grid.data) : null), [grid.data]);

  if (!here) return <Empty title="Location needed">Allow location, or pin a place from the command palette, to see how far the aurora reaches from where you are.</Empty>;
  if (!aurora || !now) return error ? <Empty title="No space weather feed" tone="error">{error}</Empty> : <Scanning label="Reading the oval" />;
  return <Loaded here={here} aurora={aurora} field={field} />;
}

function Loaded({ here, aurora, field }: { here: LatLon; aurora: AuroraPoint; field: AuroraField | null }): ReactElement {
  const now = useSpaceWx((s) => s.now);
  const units = useSettings((s) => s.units);
  const clock = useNow(60_000);
  const reach = useReach(here, aurora);
  const shields = useSpaceWx((s) => s.shields);
  const kp = now?.kp.ok ? now.kp.data : null;
  const status = shields
    ? shieldsStatus({ cosmic: shields.cosmic.ok ? shields.cosmic.data : null, field: shields.field.ok ? shields.field.data : null, sky: shields.sky.ok ? shields.sky.data : null }, (km) => fmt.distance(km * 1000, units))
    : null;
  const ahead = kp ? peakAhead(kp, clock) : null;
  const sun = sunElevation(here, new Date(clock));
  const dark = isDark(here, new Date(clock));
  const dayWord = dark ? "Dark" : sun < 0 ? "Twilight" : "Daylight";

  return (
    <div className="spacewx-tile-stack">
      <div className="spacewx-tile">
        <PolarOval field={field} here={here} reachLat={aurora.reachLat} />
        <div className="spacewx-tile__text">
          {reach.reachesYou ? (
            <Stat label="Chance of aurora" value={aurora.chancePct} unit="%" tone="mint" hint={`${dayWord} where you are`} />
          ) : (
            <Stat label="Visible as far south as" value={reach.lat === null ? "–" : `${Math.round(Math.abs(reach.lat))}°${reach.lat >= 0 ? "N" : "S"}`} tone="mint" hint={reachHint(reach, units)} />
          )}
          <span className="spacewx-tile__facts num">
            <span>
              <span className="v-eyebrow">Your chance</span> {aurora.chancePct} % · {dayWord.toLowerCase()}
            </span>
            {kp && (
              <span>
                <span className="v-eyebrow">Kp</span> <span className={kp.scale > 0 ? "spacewx-tile__facts-storm" : undefined}>{kp.now.toFixed(1)}</span> · {activityWords(kp.scale, kp.now)}
              </span>
            )}
            {ahead && ahead.kp >= (kp?.now ?? 0) + 1 && (
              <span>
                Up to Kp {ahead.kp.toFixed(1)} by {fmt.clock(ahead.at)}
              </span>
            )}
          </span>
        </div>
      </div>
      {status && (
        <p className={`spacewx-tile__shields spacewx-tile__shields--${status.tone}`}>
          <span className="v-eyebrow">Earth's shields</span>
          {status.line}
        </p>
      )}
    </div>
  );
}

function reachHint(reach: Reach, units: "metric" | "imperial"): string {
  if (reach.lat === null) return "The oval is too weak near your longitude right now.";
  // The context line reads "Town, Country"; the country is enough at this scale.
  const country = reach.place?.context.split(",").pop()?.trim();
  const where = country ? `over ${country}` : "over open water";
  return `${where} · ${fmt.distance(reach.distanceM ?? 0, units)} ${reach.lat >= 0 ? "north" : "south"} of you`;
}

/**
 * A view down onto the pole nearest to you, with you at the bottom edge. The disc reaches from the pole down to
 * 12° of latitude toward the equator from you (never below the equator), so the oval and your place in relation to it stay in frame.
 * The dashed ring marks the latitude down to which aurora can be seen.
 */
function PolarOval({ field, here, reachLat }: { field: AuroraField | null; here: LatLon; reachLat: number | null }): ReactElement {
  const ref = useRef<HTMLCanvasElement>(null);
  const north = here.lat >= 0;
  const floor = Math.max(0, Math.min(45, Math.abs(here.lat) - 12));
  const span = 90 - floor;
  const R = SIZE / 2;

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !field) return;
    const image = ctx.createImageData(PIXELS, PIXELS);
    const c = PIXELS / 2;
    for (let j = 0; j < PIXELS; j++) {
      for (let i = 0; i < PIXELS; i++) {
        const dx = i + 0.5 - c;
        const dy = j + 0.5 - c;
        const r = Math.hypot(dx, dy) / c;
        if (r > 1) continue;
        const colatitude = r * span;
        // Looking down on the pole, east runs counterclockwise in the north and clockwise in the south.
        const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
        const lat = north ? 90 - colatitude : -90 + colatitude;
        const lon = here.lon + (north ? bearing : -bearing);
        const [cr, cg, cb, ca] = auroraRgba(sampleField(field, lat, lon));
        const k = (j * PIXELS + i) * 4;
        image.data[k] = cr;
        image.data[k + 1] = cg;
        image.data[k + 2] = cb;
        image.data[k + 3] = ca;
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [field, here.lon, north, span]);

  const youR = ((90 - Math.abs(here.lat)) / span) * R;
  const rings = [80, 70, 60, 50, 40].filter((l) => l > floor).map((l) => ({ l, r: ((90 - l) / span) * R }));
  const reachR = reachLat !== null && Math.abs(reachLat) > floor ? ((90 - Math.abs(reachLat)) / span) * R : null;
  return (
    <motion.div className="spacewx-polar" initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", duration: 0.5, bounce: 0 }}>
      <canvas ref={ref} width={PIXELS} height={PIXELS} style={{ width: SIZE, height: SIZE }} />
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img" aria-label={`Aurora oval around the ${north ? "north" : "south"} pole, with your position and the southern limit of visibility marked`}>
        <circle cx={R} cy={R} r={R - 0.5} className="spacewx-polar__rim" />
        {rings.map(({ l, r }) => (
          <circle key={l} cx={R} cy={R} r={r} className="spacewx-polar__ring" />
        ))}
        {reachR !== null && <circle cx={R} cy={R} r={reachR} className="spacewx-polar__reach" />}
        <circle cx={R} cy={R + youR} r={5} className="spacewx-polar__you-halo" />
        <circle cx={R} cy={R + youR} r={2.4} className="spacewx-polar__you" />
      </svg>
    </motion.div>
  );
}
