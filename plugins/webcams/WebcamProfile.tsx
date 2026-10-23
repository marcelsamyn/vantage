import { ExternalLink } from "lucide-react";
import { useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard, Segmented } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { Feed } from "./Feed";
import { darkNote, KIND_LABEL, siteOf } from "./items";
import { localTime, sunInfo } from "./sky";
import type { CameraKind } from "./types";
import "./webcams.css";

const FACTS: Record<CameraKind, string> = {
  traffic: "From the road operator's traffic feed. Pictures are low resolution and refresh every few minutes.",
  weather: "A road-weather camera: operators use it to judge ice, snow and visibility.",
  view: "A webcam that its owner shares with the public, often from a town hall, hotel, harbour or ski area.",
  volcano: "A volcano observatory camera. Scientists watch these for steam, ash and glow.",
  ocean: "A camera on a moored ocean buoy. It captures six pictures around the horizon, shown here one direction at a time.",
  polar: "A camera at a research station on the Antarctic continent or a sub-Antarctic island. Winter nights there last for weeks.",
  observatory: "A camera at an astronomical observatory, used by the staff to judge weather and sky before they open the dome.",
  sky: "An all-sky camera that watches the whole dome of sky for aurora and clouds. It sees most at night.",
};

const DAYLIGHT = { day: "Day", twilight: "Twilight", night: "Night" } as const;

/** Look through one public camera, of any kind: its newest picture on the operator's schedule, or live video when offered. */
export default function WebcamProfile({ entity, onClose }: ProfilerProps<"webcam">): ReactElement {
  const c = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(30_000);
  const [mode, setMode] = useState<"still" | "clip">("still");
  const [live, setLive] = useState(false);
  const sun = c.tz ? sunInfo(c.lat, c.lon, now) : null;
  const note = c.tz ? darkNote(c, now) : null;
  const remote = c.tz !== null;

  return (
    <ProfilerCard
      band={`${KIND_LABEL[c.kind]} camera`}
      tone={remote ? "sodium" : "ice"}
      name={c.name}
      kicker={c.providerName}
      onClose={onClose}
      rows={[
        c.direction && ["Facing", c.direction],
        c.tz && ["Local time", localTime(c.tz, now)],
        sun && ["Daylight", DAYLIGHT[sun.state]],
        ["Position", fmt.coord(c.lat, c.lon)],
        ["Refreshes", `every ${fmt.duration(c.refreshS)}`],
        here && ["From you", fmt.distance(distanceM(here, c), units)],
      ]}
      fact={FACTS[c.kind]}
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={c.page ?? c.image} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> {c.page ? `Open on ${siteOf(c.page)}` : "Full image"}
        </a>
      }
      source={c.license}
    >
      {c.video && !c.stream && (
        <div className="webcams-profile__mode">
          <Segmented
            label="View"
            value={mode}
            onChange={setMode}
            options={[
              { value: "still", label: "Latest still" },
              { value: "clip", label: "Recent clip" },
            ]}
          />
        </div>
      )}
      <div className="webcams-profile__media">
        {mode === "clip" && c.video ? <video src={c.video} muted autoPlay loop playsInline /> : <Feed key={c.id} src={c.image} refreshS={c.refreshS} frames={c.frames} stream={c.stream} alt={`View from ${c.name}`} onLive={setLive} />}
        {live && (
          <span className="webcams-tile__rec webcams-focus__rec num">
            <i aria-hidden /> REC
          </span>
        )}
        {note && <span className="webcams-tile__note">{note}</span>}
      </div>
    </ProfilerCard>
  );
}
