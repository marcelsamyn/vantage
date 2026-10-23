import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings, type Units } from "../../app/core/settings";
import { Empty, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { inMediterranean, levelNear, steepestCooling } from "./argo";
import { ArgoChart } from "./ArgoChart";
import { depth, fetchArgoProfile, temperature } from "./client";
import type { ArgoProfile as Profile } from "./types";
import "./sea.css";

const DAY_MS = 86_400_000;
const WHEN = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** One sentence worth knowing about this dive, from its own numbers. */
function fact(p: Profile, units: Units): string {
  const levels = p.latest.levels;
  const deepest = levels[levels.length - 1];
  if (!deepest) return "";
  const rhythm = p.cycleDays ? `every ${fmt.one(p.cycleDays)} days` : "every ten days or so";
  const cooling = steepestCooling(levels);
  const lead =
    deepest.presDbar >= 3000
      ? `This is a Deep Argo float: it dives to ${depth(deepest.presDbar, units)}, far below the 2,000 m of the standard robots.`
      : `It drifts with the current for most of each cycle, then dives to ${depth(deepest.presDbar, units)} and climbs back up, measuring as it rises, to radio its data to a satellite ${rhythm}.`;
  const warmDeep = deepest.presDbar >= 1500 && deepest.tempC >= 10 && inMediterranean(p.latest.lat, p.latest.lon);
  const warm = warmDeep ? ` Down there it is still ${temperature(deepest.tempC, units)}: most of the ocean is below 4 °C at this depth, but the shallow Strait of Gibraltar keeps the cold Atlantic bottom water out of the Mediterranean.` : "";
  const layer = !warmDeep && cooling ? ` The water cools fastest between ${depth(cooling.fromDbar, units)} and ${depth(cooling.toDbar, units)}, from ${temperature(cooling.fromC, units)} to ${temperature(cooling.toC, units)}.` : "";
  return `${lead}${warm}${layer}`;
}

/** Profiler for an Argo float: where it last came up, and the water it measured on the way, from the deepest point to the surface. */
export default function ArgoProfileCard({ entity, onClose }: ProfilerProps<"argo">): ReactElement {
  const listed = entity.data;
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const now = useNow(60_000);
  const { data, error, loading } = usePoll((signal) => fetchArgoProfile(listed.platform, signal), null, [listed.platform]);
  const latest = data?.latest;
  const surface = latest?.levels[0];
  const kilometre = latest ? levelNear(latest.levels, 1000, 120) : null;
  const next = data?.cycleDays && latest ? latest.time + data.cycleDays * DAY_MS : null;
  const at = latest ?? listed;

  return (
    <ProfilerCard
      band="Ocean robot · Argo float"
      tone="ice"
      name={`Float ${listed.platform}`}
      kicker={`Dive ${at.cycle}`}
      onClose={onClose}
      loading={loading && !data}
      rows={[
        ["Last surfaced", `${WHEN.format(at.time)} · ${fmt.ago(at.time, now)}`],
        ["Came up at", fmt.coord(at.lat, at.lon)],
        here && ["From you", `${fmt.distance(distanceM(here, at), units)} ${compassPoint(bearingDeg(here, at))}`],
        latest && ["Dived to", depth(latest.levels[latest.levels.length - 1]?.presDbar ?? listed.maxPresDbar, units)],
        surface && ["Surface water", temperature(surface.tempC, units)],
        kilometre && [`At ${depth(kilometre.presDbar, units)}`, temperature(kilometre.tempC, units)],
        data?.cycleDays && ["Dives every", `${fmt.one(data.cycleDays)} days${next ? ` · next around ${DAY.format(Math.max(next, now))}` : ""}`],
      ]}
      fact={data ? fact(data, units) : undefined}
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={`https://fleetmonitoring.euro-argo.eu/float/${encodeURIComponent(listed.platform)}`} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Float page at Euro-Argo
        </a>
      }
      source="Argo data were collected and made freely available by the International Argo Program and the national programs that contribute to it · Euro-Argo, Ifremer"
    >
      {latest ? <ArgoChart levels={latest.levels} units={units} /> : error ? (
        <Empty title="No dive found for this float" tone="error">
          {error.message}
        </Empty>
      ) : null}
    </ProfilerCard>
  );
}
