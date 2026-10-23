import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Empty, ProfilerCard, Scanning } from "../../app/ui";
import { TRAIN_CROWDING, delayTone, fetchTrain } from "./client";
import { Delay, Pips, RUN_STATUS, StopList, mainTime } from "./Parts";
import type { TrainDetail } from "./types";
import "./transit.css";

/** Profiler for an Italian or Belgian train: where it is, how late, and every stop with planned and actual times. */
export default function TrainProfile({ entity, onClose }: ProfilerProps<"train">): ReactElement {
  const ref = entity.data;
  const { data, error } = usePoll((signal) => fetchTrain(ref, signal), 30_000, [entity.id]);
  const now = useNow(15_000);

  if (!data) {
    return (
      <ProfilerCard band="Train profile" name={ref.label} kicker={ref.country === "IT" ? "Trenitalia" : "SNCB"} rows={[]} onClose={onClose} source={ref.country === "IT" ? "Trenitalia ViaggiaTreno" : "iRail"}>
        {error ? <Empty title="Train unavailable" tone="error">{error.message}</Empty> : <Scanning label="Finding the train" />}
      </ProfilerCard>
    );
  }

  const next = data.stops.findIndex((s) => !s.passed && !s.cancelled);
  const tone = data.status === "cancelled" ? "alarm" : data.delayMin === null ? "ice" : delayTone(data.delayMin);
  const nextStop = next >= 0 ? data.stops[next] : undefined;
  const nextTime = nextStop ? mainTime(nextStop) : null;

  return (
    <ProfilerCard
      band="Train profile"
      tone={tone === "mint" ? "mint" : tone}
      name={data.label}
      kicker={`${data.origin} → ${data.destination}`}
      onClose={onClose}
      rows={[
        ["Status", RUN_STATUS[data.status]],
        data.delayMin !== null && ["Delay", <Delay key="delay" minutes={data.delayMin} unit=" min" />],
        data.lastSeen && ["Last seen", `${data.lastSeen.station} · ${fmt.clock(data.lastSeen.at)} (${fmt.ago(data.lastSeen.at, now)})`],
        nextStop && data.status === "running" && ["Next stop", `${nextStop.name}${nextTime?.planned != null ? ` · ${fmt.clock(nextTime.actual ?? nextTime.planned)}` : ""}${nextStop.platform ? ` · platform ${nextStop.platform}` : ""}`],
        data.occupancy && ["Crowding", <span key="occ" className="transit-inline"><Pips crowding={TRAIN_CROWDING[data.occupancy]} /> {TRAIN_CROWDING[data.occupancy].label}</span>],
        ["Operator", data.operator],
      ]}
      fact={data.notes.length > 0 ? data.notes.slice(0, 3).join(" · ") : undefined}
      source={data.source}
    >
      <StopList stops={data.stops} running={data.status === "running"} />
    </ProfilerCard>
  );
}
