import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard, Sparkline } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { fetchHistory, LEVEL_TONE, LEVEL_WORD, showValue } from "./client";
import { KIND_TITLE, sentenceFor } from "./scales";
import type { Reading, SensorHistory } from "./types";
import "./sensors.css";

/** Profiler for one sensor: the reading with its other values, how it compares to a normal one, and its recent history. */
export default function SensorProfile({ entity, onClose }: ProfilerProps<"sensor">): ReactElement {
  const s = entity.data;
  const here = useLocation((st) => st.here);
  const units = useSettings((st) => st.units);
  const key = s.historyKey;
  const history = usePoll((signal) => (key ? fetchHistory(key, signal) : Promise.reject(new Error("no history"))), null, [key], !key);
  const tone = LEVEL_TONE[s.level];
  const survey = s.network === "safecast" && !s.live;

  return (
    <ProfilerCard
      band={survey ? "Radiation survey" : `${KIND_TITLE[s.kind]} sensor · ${LEVEL_WORD[s.level].toLowerCase()}`}
      tone={tone}
      // The card capitalises its name, which would turn µg into MG, so the unit goes in the rows.
      name={showValue(s)}
      kicker={s.name ?? s.networkName}
      onClose={onClose}
      rows={[
        ...s.readings.map((r) => [r.label, formatReading(r)] as const),
        ["Network", s.networkName],
        [survey ? "Surveyed" : "Measured", `${new Date(s.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: s.live ? "short" : undefined })}${s.live ? ` · ${fmt.ago(s.at)}` : ""}`],
        here && ["From you", `${fmt.distance(distanceM(here, s), units)} ${compassPoint(bearingDeg(here, s))}`],
        ["Position", fmt.coord(s.lat, s.lon)],
      ]}
      fact={sentenceFor(s.kind, s.value, s.readings, s.live)}
      source={s.network === "sensor.community" ? "Sensor.Community: open data from volunteers' sensors (ODbL)" : s.network === "bfs" ? "BfS ODL measuring network (data licence Germany, DL-DE-BY-2.0)" : "Safecast: volunteers' measurements (CC0)"}
    >
      {key && <Trend history={history.data} loading={history.loading} error={history.error} tone={tone} />}
    </ProfilerCard>
  );
}

const DECIMALS: Record<string, number> = { "µSv/h": 3, hPa: 0 };
const formatReading = (r: Reading): string => `${r.value.toFixed(DECIMALS[r.unit] ?? 1)} ${r.unit}`;

function Trend({ history, loading, error, tone }: { history: SensorHistory | undefined; loading: boolean; error: Error | null; tone: "mint" | "sodium" | "alarm" }): ReactElement {
  if (!history) {
    return <div className="sensors-trend__note">{loading ? "Loading history…" : (error?.message ?? "No history")}</div>;
  }
  const values = history.points.map((p) => p.v);
  if (values.length < 2) return <div className="sensors-trend__note">Not enough readings to draw a trend.</div>;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const digits = history.unit === "µSv/h" ? 3 : 1;
  return (
    <div className="sensors-trend">
      <div className="v-eyebrow">{history.window}</div>
      <Sparkline values={values} min={0} max={Math.max(hi * 1.15, 1e-9)} tone={tone} height={44} width={280} />
      <div className="sensors-trend__note">
        Low {lo.toFixed(digits)} · high {hi.toFixed(digits)} {history.unit}
      </div>
    </div>
  );
}
