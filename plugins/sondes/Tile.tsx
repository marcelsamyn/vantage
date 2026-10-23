import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useMotionNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings, type Units } from "../../app/core/settings";
import { Empty, Scanning, Stat } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM, type LatLon } from "../../shared/geo";
import { altitudeLabel, fetchSites, isFlying, nextLaunch, projected, useSondes } from "./client";
import type { LaunchSite, Sonde } from "./types";
import "./sondes.css";

/** Beyond this distance the nearest balloon is not nearby; the tile leads with the next launch instead. */
const FAR_M = 1_500_000;
const GAUGE_W = 56;
const GAUGE_H = 148;
const GAUGE_TOP_M = 40_000;

/** Briefing tile: the weather balloon nearest to you right now, and the next launch from the closest site. */
export default function SondesTile(): ReactElement {
  const snapshot = useSondes((s) => s.snapshot);
  const error = useSondes((s) => s.error);
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  // Balloons drift between reports: every second while someone watches, every 15 s at rest.
  const now = useMotionNow(1000, 15_000);
  const sites = usePoll((signal) => fetchSites(signal), null, []);

  if (!here) return <Empty title="Location needed">Allow location, or pin a place from the command palette, to find the balloon nearest to you.</Empty>;
  if (!snapshot) return error ? <Empty title="No balloon feed" tone="error">{error}</Empty> : <Scanning label="Listening for radiosondes" />;

  const flying = snapshot.sondes.filter(isFlying);
  const nearest = flying
    .map((s) => {
      const p = projected(s, now);
      return { s, p, d: distanceM(here, p), b: bearingDeg(here, p) };
    })
    .sort((a, b) => a.d - b.d)[0];
  const launch = sites.data ? upcomingLaunch(sites.data, here, now) : null;

  // A balloon thousands of kilometres away is trivia; when nothing flies nearby, the next launch is what matters.
  if (nearest && launch && nearest.d > FAR_M) {
    const open = (): void => profile.open({ kind: "sonde", id: nearest.s.serial, data: { ...nearest.s, fetchedAt: snapshot.fetchedAt } });
    return (
      <div className="sondes-tile">
        <Stat
          label="Next launch near you"
          value={fmt.until(launch.launchAt, now).replace(/^in /, "")}
          tone="sodium"
          hint={`${launch.site.name} · ${fmt.distance(launch.distanceM, units)} ${compassPoint(launch.bearing)} · around ${fmt.clock(launch.launchAt)}`}
        />
        <button type="button" className="sondes-tile__far" onClick={open}>
          <span className="v-eyebrow">Nearest balloon in flight</span>
          <span className="v-stat__hint num">
            {nearest.s.serial} · {fmt.distance(nearest.d, units)} {compassPoint(nearest.b)} · {altitudeLabel(nearest.p.altM, units)} up · {flying.length} in the air
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="sondes-tile">
      {nearest ? <Nearest {...nearest} count={flying.length} units={units} fetchedAt={snapshot.fetchedAt} /> : <Stat label="Balloons in the air" value="0" tone="sodium" hint="No radiosonde has been heard in the past four minutes." />}
      <div className="sondes-tile__launch">
        <span className="v-eyebrow">Next launch near you</span>
        {launch ? (
          <>
            <span className="sondes-tile__site">{launch.site.name}</span>
            <span className="v-stat__hint num">
              around {fmt.clock(launch.launchAt)} · {fmt.until(launch.launchAt, now)} · {fmt.distance(launch.distanceM, units)} {compassPoint(launch.bearing)}
            </span>
          </>
        ) : sites.error ? (
          <span className="v-stat__hint">Launch sites are unavailable: {sites.error.message}</span>
        ) : (
          <span className="v-stat__hint">{sites.data ? "No launch site with a daily schedule is listed." : "Loading launch sites…"}</span>
        )}
      </div>
    </div>
  );
}

function Nearest({ s, p, d, b, count, units, fetchedAt }: { s: Sonde; p: LatLon & { altM: number }; d: number; b: number; count: number; units: Units; fetchedAt: number }): ReactElement {
  const metric = units === "metric";
  const value = metric ? fmt.one(p.altM / 1000) : fmt.int(p.altM * 3.28084);
  const rate = s.vertMs === null ? null : Math.abs(s.vertMs) < 1 ? "floating" : `${s.vertMs > 0 ? "climbing" : "falling"} ${fmt.one(Math.abs(s.vertMs))} m/s`;
  const y = (m: number): number => GAUGE_H - 6 - (Math.min(m, GAUGE_TOP_M) / GAUGE_TOP_M) * (GAUGE_H - 14);
  const burst = s.prediction?.burst?.altM ?? null;

  return (
    <button type="button" className="sondes-tile__nearest" onClick={() => profile.open({ kind: "sonde", id: s.serial, data: { ...s, fetchedAt } })}>
      <svg className="sondes-gauge" viewBox={`0 0 ${GAUGE_W} ${GAUGE_H}`} width={GAUGE_W} height={GAUGE_H} aria-label={`Altitude ${value} ${metric ? "kilometres" : "feet"}`}>
        {[0, 10_000, 20_000, 30_000, 40_000].map((m) => (
          <g key={m}>
            <line x1={6} x2={22} y1={y(m)} y2={y(m)} className="sondes-gauge__tick" />
            <text x={26} y={y(m) + 3} className="sondes-gauge__label">
              {m / 1000}
            </text>
          </g>
        ))}
        <line x1={14} x2={14} y1={y(0)} y2={y(GAUGE_TOP_M)} className="sondes-gauge__axis" />
        {burst !== null && <line x1={6} x2={22} y1={y(burst)} y2={y(burst)} className="sondes-gauge__burst" />}
        <circle cx={14} cy={y(p.altM)} r={4.2} className="sondes-gauge__dot" />
      </svg>
      <span className="sondes-tile__text">
        <Stat label="Nearest balloon" value={value} unit={metric ? "km up" : "ft up"} tone="sodium" hint={`${s.serial}${rate ? ` · ${rate}` : ""}`} />
        <span className="v-stat__hint num">
          {fmt.distance(d, units)} {compassPoint(b)} of you · {count} in the air
        </span>
      </span>
    </button>
  );
}

function upcomingLaunch(sites: LaunchSite[], here: LatLon, now: number): { site: LaunchSite; launchAt: number; distanceM: number; bearing: number } | null {
  let best: { site: LaunchSite; launchAt: number; distanceM: number; bearing: number } | null = null;
  for (const site of sites) {
    const next = nextLaunch(site, now);
    if (!next) continue;
    const d = distanceM(here, site);
    if (!best || d < best.distanceM) best = { site, launchAt: next.launchAt, distanceM: d, bearing: bearingDeg(here, site) };
  }
  return best;
}
