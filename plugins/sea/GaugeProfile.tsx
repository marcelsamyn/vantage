import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings, type Units } from "../../app/core/settings";
import { Empty, ProfilerCard, Tag } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { LEVEL_NAME, LEVEL_TONE, every, fetchGauge, height } from "./client";
import { GaugeChart } from "./GaugeChart";
import type { GaugeReading, Swing } from "./types";
import "./sea.css";

const rhythm = (s: Swing): string => (s.kind === "oscillation" ? `up and down${s.periodMin ? `, about every ${s.periodMin} minutes` : ""}` : "in one jump");

/** Which way the sea is moving over the past hour, from the tide-and-all level. */
function trend(levelMm: GaugeReading["levelMm"], units: Units): string | null {
  const last = levelMm.length - 1;
  const now = levelMm[last];
  const before = [60, 59, 61, 58, 62].map((back) => levelMm[last - back]).find((v) => v != null);
  if (now == null || before == null) return null;
  const perHour = (now - before) / 1000;
  return Math.abs(perHour) < 0.01 ? "steady" : `${perHour > 0 ? "rising" : "falling"} ${height(Math.abs(perHour), units)} an hour`;
}

/** One or two sentences on what the gauge is doing, in terms of its own usual noise. */
function verdict(reading: GaugeReading, units: Units): string {
  const { recent, day, quietM, coarse } = reading.analysis;
  const clock = (ms: number): string => fmt.clock(ms);
  const caution = coarse ? ` This gauge reports ${every(reading.gauge.intervalMin)}, which is too slow to see quick oscillations, so it can say restless but never unusual.` : "";
  if (recent.level !== "normal") {
    return `In the half hour to ${clock(recent.to)} the water swung ${height(recent.rangeM, units)} ${rhythm(recent)}. This gauge usually moves ${height(quietM, units)} in that time.${caution}`;
  }
  if (day.level !== "normal") {
    return `Quiet now. Between ${clock(day.from)} and ${clock(day.to)} the water swung ${height(day.rangeM, units)} ${rhythm(day)}; this gauge usually moves ${height(quietM, units)}.${caution}`;
  }
  return `Within its usual range. In quiet hours the water here moves about ${height(quietM, units)} in half an hour once the tide is taken out.${caution}`;
}

/** Profiler for a tide gauge: the sea's height right now, the last 24 hours with the tide taken out, and whether the water is swinging more than it usually does. */
export default function GaugeProfile({ entity, onClose }: ProfilerProps<"tidegauge">): ReactElement {
  const listed = entity.data;
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const now = useNow(30_000);
  const { data, error, loading } = usePoll((signal) => fetchGauge(listed.code, signal), 60_000, [listed.code]);
  const gauge = data?.gauge ?? listed;
  const level = data?.analysis.recent.level ?? gauge.level;
  const present = data?.levelMm.flatMap((v) => (v === null ? [] : [v / 1000])) ?? [];
  const moved = present.length ? Math.max(...present) - Math.min(...present) : null;
  const direction = data ? trend(data.levelMm, units) : null;

  return (
    <ProfilerCard
      band="Sea level gauge"
      tone={level === "unusual" ? "alarm" : "sodium"}
      name={gauge.name}
      kicker={[gauge.country, gauge.code].filter(Boolean).join(" · ")}
      onClose={onClose}
      loading={loading && !data}
      rows={[
        ["Right now", `${height(gauge.valueM, units)} above the gauge's zero${direction ? ` · ${direction}` : ""}`],
        ["Reading", `${fmt.ago(gauge.at, now)} · ${every(gauge.intervalMin)}`],
        moved !== null && ["Moved in 24 h", `${height(moved, units)} from lowest to highest`],
        here && ["From you", `${fmt.distance(distanceM(here, gauge), units)} ${compassPoint(bearingDeg(here, gauge))}`],
        level && ["Sea now", <Tag key="level" tone={LEVEL_TONE[level]}>{LEVEL_NAME[level]}</Tag>],
      ]}
      fact="A harbour sloshes like water in a bath: push it and it rocks back and forth at its own steady rhythm. That is a seiche. A meteotsunami is the same rocking set off by a storm front or a sudden air-pressure jump racing over shallow sea. Neither comes from an earthquake."
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={`https://www.ioc-sealevelmonitoring.org/station.php?code=${encodeURIComponent(gauge.code)}`} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> Gauge page at the IOC
        </a>
      }
      source="Sea level: VLIZ and UNESCO/IOC · unchecked data, a status board and not a tsunami warning"
    >
      {data ? (
        <div className="sea-profile">
          <p className="sea-profile__verdict">{verdict(data, units)}</p>
          <GaugeChart reading={data} units={units} />
        </div>
      ) : error ? (
        <Empty title="No readings for this gauge" tone="error">
          {error.message}
        </Empty>
      ) : null}
    </ProfilerCard>
  );
}
