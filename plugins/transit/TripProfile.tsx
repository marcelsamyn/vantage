import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Empty, ProfilerCard, Scanning } from "../../app/ui";
import { MODE_LABEL, delayTone, fetchTrip, modeGroup } from "./client";
import { AlertList, Delay, RUN_STATUS, StopList, mainTime } from "./Parts";
import "./transit.css";

/** Profiler for one bus, tram, metro, ferry or train run: where it is now and every stop with planned and live times. */
export default function TripProfile({ entity, onClose }: ProfilerProps<"trip">): ReactElement {
  const ref = entity.data;
  const { data, error } = usePoll((signal) => fetchTrip(ref.tripId, signal), 30_000, [ref.tripId]);

  if (!data) {
    return (
      <ProfilerCard band="Trip profile" name={ref.label} rows={[]} onClose={onClose} source="Transitous">
        {error ? <Empty title="Trip unavailable" tone="error">{error.message}</Empty> : <Scanning label="Reading the trip" />}
      </ProfilerCard>
    );
  }

  const group = modeGroup(data.mode);
  const nextStop = data.stops.find((s) => !s.passed && !s.cancelled);
  const nextTime = nextStop ? mainTime(nextStop) : null;
  const tone = data.status === "cancelled" ? "alarm" : data.delayMin === null ? "ice" : delayTone(data.delayMin);

  return (
    <ProfilerCard
      band={`${MODE_LABEL[group]} trip`}
      tone={tone === "mint" ? "mint" : tone}
      name={data.label || MODE_LABEL[group]}
      kicker={data.origin === data.destination ? `Circular from ${data.origin}` : `${data.origin} → ${data.destination}`}
      onClose={onClose}
      rows={[
        ["Status", RUN_STATUS[data.status]],
        data.delayMin !== null && data.status !== "cancelled" && ["Delay", <Delay key="delay" minutes={data.delayMin} unit=" min" />],
        !data.realTime && ["Times", "Timetable; this operator publishes no live times for this run"],
        nextStop && data.status === "running" && ["Next stop", `${nextStop.name}${nextTime?.planned != null ? ` · ${fmt.clock(nextTime.actual ?? nextTime.planned)}` : ""}${nextStop.platform ? ` · platform ${nextStop.platform}` : ""}`],
        data.operator && ["Operator", data.operator],
      ]}
      source={data.source}
    >
      <AlertList alerts={data.alerts} />
      <StopList stops={data.stops} running={data.status === "running"} />
    </ProfilerCard>
  );
}
