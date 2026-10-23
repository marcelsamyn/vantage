import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Empty, ProfilerCard, Scanning, Sparkline, Stat } from "../../app/ui";
import { useCounterDetail, useCounters } from "./client";
import "./pulse.css";

const SOURCE = {
  Brussels: "Brussels Mobility open data · CC BY 4.0",
  Ghent: "Stad Gent open data · Modellicentie Gratis Hergebruik",
} as const;

const hourLabel = (ms: number): string => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** One bicycle counter: passages in the last hour and today, and the last 24 hours as a sparkline. */
export default function CounterProfile({ entity, onClose }: ProfilerProps<"counter">): ReactElement {
  const { data: feed } = useCounters();
  const counter = feed?.counters.find((c) => c.id === entity.data.counter.id) ?? entity.data.counter;
  const { data: detail, error, loading } = useCounterDetail(counter.id);
  const now = useNow(15_000);
  const bins = detail?.series.bins ?? [];
  const peak = bins.reduce((best, b) => (b.count > best.count ? b : best), bins[0] ?? { at: 0, count: 0 });

  return (
    <ProfilerCard
      band={counter.live ? "Bicycle counter · live" : "Bicycle counter"}
      tone={counter.live ? "sodium" : "ice"}
      name={counter.name}
      kicker={counter.city}
      onClose={onClose}
      rows={[
        counter.at !== null && [counter.live ? "Last bicycle" : "Latest data", counter.live ? fmt.ago(counter.at, now) : new Date(counter.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })],
        ["Position", fmt.coord(counter.lat, counter.lon)],
      ]}
      fact={
        counter.live
          ? "The counter updates when a bicycle passes. Nothing is recorded about who rides: it only counts."
          : "Ghent publishes its counters a month at a time, so this shows the latest day the city has released, not today."
      }
      source={SOURCE[counter.city]}
    >
      <div className="pulse-counter">
        <div className="pulse-counter__stats">
          {counter.hour !== null && <Stat label="Last hour" value={fmt.int(counter.hour)} unit="bikes" size="lg" tone={counter.hour > 0 ? "sodium" : undefined} />}
          {counter.day !== null && <Stat label={counter.dayLabel === "today" ? "Today" : "Latest day"} value={fmt.int(counter.day)} unit="bikes" size={counter.hour !== null ? "md" : "lg"} />}
        </div>
        {error && !detail ? (
          <Empty title="No history for this counter" tone="error">
            {error.message}
          </Empty>
        ) : loading && !detail ? (
          <Scanning label="Loading history" />
        ) : (
          bins.length > 1 && (
            <figure className="pulse-counter__chart">
              <Sparkline values={bins.map((b) => b.count)} tone="sodium" height={56} />
              <figcaption className="pulse-counter__caption num">{detail?.label}</figcaption>
              <p className="pulse-note">
                Busiest hour in this window: {fmt.int(peak.count)} bicycles at {hourLabel(peak.at)}, in your local time.
              </p>
            </figure>
          )
        )}
      </div>
    </ProfilerCard>
  );
}
