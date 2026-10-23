import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, Page, Scanning } from "../../app/ui";
import { useDrones } from "./client";
import { hasRecentPosition, receiverProblem, recentDrones } from "./view";
import "./drones.css";

export default function DronesScreen(): ReactElement {
  const { data, error, loading, refresh } = useDrones();
  const now = useNow();
  const units = useSettings((s) => s.units);
  const problem = receiverProblem(data, now);
  const drones = recentDrones(data, now);
  return (
    <Page eyebrow="Nearby radio signals" title="Drones" lede="Remote ID broadcasts heard by your receiver. Reception depends on range, radio support and what drones broadcast." actions={<Button onClick={refresh}>Refresh receiver</Button>}>
      {loading && !data && <Scanning label="Connecting to your drone receiver" />}
      {error && <Empty title="Receiver did not answer" tone="error">{error.message}. Check the receiver address, network connection and feed access permissions.</Empty>}
      {problem && <Empty title={data?.state === "setup" ? "Set up a drone receiver" : "Receiver data is stale"}>{problem}</Empty>}
      {data?.state === "setup" && <p className="drones-source"><a href="https://github.com/isaacbentley/orecchino-esp32" target="_blank" rel="noreferrer">Orecchino receiver hardware</a> · <a href="https://github.com/ifnull/dump3411" target="_blank" rel="noreferrer">dump3411 for a Linux receiver</a></p>}
      {data?.state === "ready" && !problem && (
        <>
          <div className="drones-summary num">{drones.length} recent detections · {fmt.int(data.messages)} decoded messages · Snapshot {fmt.ago(data.fetchedAt, now)}</div>
          {drones.length === 0 && <Empty title="No recent drone broadcasts">The receiver is connected. No drone has been heard in the last 60 seconds. Keep the receiver running; only broadcasts within radio range can appear.</Empty>}
          <div className="drones-list">
            {drones.map((drone) => (
              <button className="drones-row" key={drone.id} onClick={() => profile.open({ kind: "drone", id: drone.id, data: drone })}>
                <span className="drones-identity"><strong>{drone.id}</strong><span>{drone.aircraftType ?? drone.idType} · {drone.transport ?? "Remote ID"}</span></span>
                <span className="drones-reading num">{hasRecentPosition(drone, now) ? `${drone.position.lat}, ${drone.position.lon}` : drone.position ? "Position report is old or undated" : "Position not broadcast"}<span>{drone.speedKt === null ? "Speed not broadcast" : fmt.speedKnots(drone.speedKt, units)} · Heard {fmt.ago(drone.reportedAt, now)}</span></span>
              </button>
            ))}
          </div>
        </>
      )}
      <p className="drones-source">Source: your Remote ID receiver · <a href="https://github.com/ifnull/dump3411/blob/main/FEED.md" target="_blank" rel="noreferrer">Remote ID feed format</a></p>
    </Page>
  );
}
