import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { useDrones } from "./client";
import { hasRecentPosition, operatorLabel, receiverProblem, recentDrones } from "./view";
import "./drones.css";

function mapLink(position: LatLon): ReactElement {
  return <a href={`https://www.google.com/maps/search/?api=1&query=${position.lat},${position.lon}`} target="_blank" rel="noreferrer">{position.lat}, {position.lon}</a>;
}

export default function DroneProfile({ entity, onClose }: ProfilerProps<"drone">): ReactElement {
  const { data, error } = useDrones();
  const now = useNow();
  const units = useSettings((s) => s.units);
  const live = recentDrones(data, now).find((v) => v.id === entity.id);
  const drone = live ?? entity.data;
  const operator = drone.operator;
  const height = (metres: number): string => fmt.distance(metres, units);
  return (
    <ProfilerCard band="Drone Remote ID" name={drone.id} kicker={drone.aircraftType ?? drone.idType} tone="sodium" onClose={onClose}
      rows={[
        ["Reception", error ? "Receiver unavailable; last received report" : receiverProblem(data, now) ?? (live ? "Recent broadcast" : "No recent broadcast; last received report")],
        ["ID type", drone.idType],
        ["Last heard", fmt.ago(drone.reportedAt, now)],
        ["Drone position", drone.position ? mapLink(drone.position) : "Not broadcast"],
        ["Position report", drone.positionAt === null ? "Age not broadcast" : `${fmt.ago(drone.positionAt, now)}${hasRecentPosition(drone, now) ? "" : " · stale"}`],
        drone.altitudeM !== null && ["Geometric altitude", height(drone.altitudeM)],
        drone.heightM !== null && ["Height above ground / takeoff", height(drone.heightM)],
        drone.speedKt !== null && ["Ground speed", fmt.speedKnots(drone.speedKt, units)],
        drone.trackDeg !== null && ["True track", `${fmt.one(drone.trackDeg)}°`],
        drone.verticalSpeedMps !== null && ["Vertical speed", units === "imperial" ? `${fmt.one(drone.verticalSpeedMps * 196.850394)} ft/min` : `${fmt.one(drone.verticalSpeedMps)} m/s`],
        drone.rssiDbm !== null && ["Signal", `${fmt.one(drone.rssiDbm)} dBm`],
        drone.messageCount !== null && ["Decoded messages", fmt.int(drone.messageCount)],
        drone.transports.length > 0 && ["Radio transports", drone.transports.join(", ")],
        drone.description !== null && ["Broadcast flight description", drone.description],
        drone.descriptionAt !== null && ["Description report", fmt.ago(drone.descriptionAt, now)],
        operator?.id && ["Operator ID", operator.id],
        operator?.position && [operatorLabel(operator.locationType), mapLink(operator.position)],
        operator && ["Operator report", operator.reportedAt === null ? "Age not broadcast" : fmt.ago(operator.reportedAt, now)],
        operator?.takeoffAltitudeM !== null && operator?.takeoffAltitudeM !== undefined && ["Takeoff geometric altitude", height(operator.takeoffAltitudeM)],
      ]}
      fact={operator?.locationType === "takeoff" ? "The launch point is where the drone took off. It does not locate the operator now." : "Positions and flight descriptions are what the transmitter broadcasts. Old positions are removed from the map after 60 seconds."}
      source="Drone Remote ID: your dump3411 receiver"
    />
  );
}
