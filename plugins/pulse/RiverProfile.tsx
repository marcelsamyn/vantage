import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Empty, ProfilerCard, Scanning, Stat, Tag, type Tone } from "../../app/ui";
import { LevelChart } from "./charts";
import { useRiverSeries } from "./client";
import type { RiverSource } from "./types";
import { STATUS_WORDS, levelText, trendText } from "./words";
import "./pulse.css";

const TONE = { normal: "mint", elevated: "sodium", high: "alarm", unknown: "ice" } as const satisfies Record<string, Tone>;

const CREDIT: Record<RiverSource, string> = {
  "Waterinfo (Flanders)": "Waterinfo.be, Vlaamse overheid open data",
  "Hub'Eau (France)": "Hub'Eau, Licence Ouverte 2.0",
  "ARPA Lombardia": "ARPA Lombardia via Regione Lombardia open data · CC0",
};

/** One river gauge: the level now, 48 hours of history and the thresholds the source publishes. */
export default function RiverProfile({ entity, onClose }: ProfilerProps<"rivergauge">): ReactElement {
  const gauge = entity.data.gauge;
  const { data, error, loading } = useRiverSeries(gauge.id);
  const now = useNow(30_000);
  const t = gauge.thresholds;
  const trend = trendText(gauge.trend3h);
  // The newest point of the long series can be fresher than the map's summary.
  const points = data?.points ?? [];
  const latest = points[points.length - 1];
  const level = latest?.level ?? gauge.level;

  return (
    <ProfilerCard
      band="River level · live"
      tone={TONE[gauge.status]}
      name={gauge.name}
      kicker={[gauge.river, gauge.source].filter(Boolean).join(" · ")}
      onClose={onClose}
      rows={[
        trend && ["Trend", trend],
        (latest?.at ?? gauge.at) !== null && ["Measured", fmt.ago((latest?.at ?? gauge.at) as number, now)],
        t && t.prewatch !== null && ["Pre-watch level", levelText(t.prewatch)],
        t && t.watch !== null && ["Watch level", levelText(t.watch)],
        t && t.prealarm !== null && ["Pre-alarm level", levelText(t.prealarm)],
        t && t.alarm !== null && ["Alarm level", levelText(t.alarm)],
      ]}
      fact={
        t
          ? "The authority sets these levels for each gauge. Crossing the watch or alarm line means water may leave the riverbed nearby."
          : `${gauge.source} publishes no alert thresholds for this gauge, so VANTAGE shows the level and its trend and does not call it normal or high.`
      }
      actions={
        gauge.url && (
          <a className="v-btn v-btn--sm v-btn--ghost" href={gauge.url} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> Source
          </a>
        )
      }
      source={CREDIT[gauge.source]}
    >
      <div className="pulse-river">
        <div className="pulse-river__head">
          <Stat label="Level" value={level === null ? "n/a" : levelText(level)} size="lg" tone={gauge.status === "unknown" ? undefined : TONE[gauge.status]} />
          <Tag tone={gauge.status === "unknown" ? undefined : TONE[gauge.status]}>{STATUS_WORDS[gauge.status]}</Tag>
        </div>
        {error && !data ? (
          <Empty title="No 48 hour history" tone="error">
            {error.message}
          </Empty>
        ) : loading && !data ? (
          <Scanning label="Loading 48 hours" />
        ) : points.length > 1 ? (
          <LevelChart points={points} thresholds={t} status={gauge.status} now={now} />
        ) : (
          <p className="pulse-note">The source returned no readings for the last 48 hours.</p>
        )}
      </div>
    </ProfilerCard>
  );
}
