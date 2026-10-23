import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Button, Meter, ProfilerCard, Scanning } from "../../app/ui";
import { MODE_LABEL, crowdingOf, delayTone, fetchOccupancy, fetchTrip, fetchVehicle, useTransitNow, modeGroup, positionAt } from "./client";
import { Pips, StopList } from "./Parts";
import { isTransitousTrip } from "./trip-id";
import type { Occupancy } from "./types";
import "./transit.css";

const IS_ROME_TRIP = /_it-Lazio-Rome_/;
const TRANSITOUS = "Transitous (open GTFS data from operators)";

/** Every stop of the vehicle's run, refreshed with the operator's live times. */
function RunStops({ tripId }: { tripId: string }): ReactElement {
  const { data, error } = usePoll((signal) => fetchTrip(tripId, signal), 30_000, [tripId]);
  if (data) return <StopList stops={data.stops} running={data.status === "running"} />;
  return error ? <p className="dim">Stops unavailable: {error.message}</p> : <Scanning label="Reading the stops" />;
}

/** Profiler for a moving vehicle: its line, the stop it just left, the next one, how full it is, and whether it is late. */
export default function VehicleProfile({ entity, onClose }: ProfilerProps<"vehicle">): ReactElement {
  const s = entity.data;
  const now = useTransitNow();
  const units = useSettings(state => state.units);
  const { data: trackingView, error: trackingError } = usePoll(signal => fetchVehicle(entity.id, s.fix, signal), 10_000, [entity.id], !s.vehicleId);
  const p = positionAt(s, now);
  const group = modeGroup(s.mode);
  const late = s.delayMin !== null && s.delayMin >= 1;
  const tone = s.delayMin === null ? "ice" : delayTone(s.delayMin) === "mint" ? "ice" : delayTone(s.delayMin);

  // ATAC refreshes occupancy about every 10 s, so the profile asks again instead of keeping the value from the click.
  const rome = IS_ROME_TRIP.test(s.tripId) || s.vehicleId?.startsWith("atac:") === true;
  const { data: live } = usePoll((signal) => fetchOccupancy(s.fix?.tripId ?? s.tripId, signal, s.fix?.label), 10_000, [s.tripId, s.fix?.tripId, s.fix?.label], !rome);
  const occupancy: Occupancy | null = rome ? (live ? live.occupancy : s.occupancy) : s.occupancy;
  const crowding = occupancy ? crowdingOf(occupancy) : null;

  const timing = s.delayMin === null ? "Scheduled (no live data)" : s.delayMin === 0 ? "On time (live)" : s.delayMin > 0 ? `${s.delayMin} min late (live)` : `${-s.delayMin} min early (live)`;
  const stops = s.from && s.to;
  const fix = s.fix;
  const positionMessage = (): string => {
    if (!fix) return s.realTime ? "Position estimated from the operator's arrival predictions." : "Position estimated from the timetable.";
    if (!p) return "Position unavailable. Waiting for a vehicle report.";
    if (fix.at === 0) return "Operator-derived position. The source does not give its measurement time.";
    if (p.quality === "last-known") return "Last measured position. The current position is uncertain.";
    if (p.estimated) return "Current position estimated from measured movement along the route.";
    return "Position reported by the vehicle.";
  };

  return (
    <ProfilerCard
      band={`${MODE_LABEL[group]} profile`}
      tone={tone}
      name={s.route || MODE_LABEL[group]}
      kicker={s.from && s.to ? `${s.from.name} → ${s.to.name}` : (fix?.label ?? MODE_LABEL[group])}
      onClose={onClose}
      rows={[
        s.from && ["Left", `${s.from.name} · ${fmt.clock(s.departure)}`],
        s.to && ["Next stop", `${s.to.name} · ${now < s.arrival ? fmt.until(s.arrival, now) : "arriving"}`],
        (!fix || s.delayMin !== null) && ["Timing", timing],
        crowding && ["Seats", <span key="seats" className="transit-inline"><Pips crowding={crowding} /> {crowding.label}</span>],
        fix && ["Vehicle", fix.label],
        fix && ["Position", fix.at > 0 ? `${fix.evidence === "route-distance" ? "Operator report" : "GPS"} ${fmt.ago(fix.at, now)}` : "Measurement time unavailable"],
        p && p.ranges.length > 0 && Number.isFinite(p.rangeM) && ["Model range", `About ${fmt.distance(p.rangeM, units)} along the route`],
        s.mode !== "OTHER" && ["Mode", s.mode.toLowerCase().replace(/_/g, " ")],
      ]}
      fact={trackingError?.message ?? trackingView?.notice ?? positionMessage()}
      actions={
        s.to && (
          <Button size="sm" onClick={() => s.to && profile.open({ kind: "stop", id: s.to.stopId, data: { ...s.to, modes: [s.mode] } })}>
            Departures at {s.to.name}
          </Button>
        )
      }
      source={[fix ? fix.feed : TRANSITOUS, crowding && rome ? "occupancy: ATAC, Roma Servizi per la Mobilità" : null].filter(Boolean).join(" · ")}
    >
      {p && stops && !fix && <Meter value={p.progress} tone={late ? "sodium" : "ice"} ticks />}
      {isTransitousTrip(s.tripId) && <RunStops tripId={s.tripId} />}
    </ProfilerCard>
  );
}
