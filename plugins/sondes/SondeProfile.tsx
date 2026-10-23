import { ExternalLink, Layers, Navigation } from "lucide-react";
import type { ReactElement } from "react";
import { api, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import type { Place } from "../../shared/location";
import { bearingDeg, compassPoint, distanceM, lookAngle } from "../../shared/geo";
import { routeTo, showLayer } from "../city/client";
import { altitudeLabel, fetchTrack, isFlying, modelName, projected, useSondes } from "./client";
import { FlightProfile } from "./FlightProfile";
import type { Sonde } from "./types";

const KT_PER_MS = 1.94384;

/** Profiler for one weather balloon: what is hanging under it, how to hear it, and where it will come down. */
export default function SondeProfile({ entity, onClose }: ProfilerProps<"sonde">): ReactElement {
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const now = useNow(1000);
  const watched = useSondes((s) => s.snapshot?.sondes.find((x) => x.serial === entity.data.serial) ?? null);
  const s: Sonde = watched ?? entity.data;
  const lost = watched === null;

  const track = usePoll((signal) => fetchTrack(s.serial, signal), 60_000, [s.serial]);
  const p = projected(s, now);
  const flying = isFlying(s);
  const landing = s.prediction?.landing ?? null;
  // Where to go to pick it up: the predicted landing point while it flies, the last heard position once it is down.
  const target = flying ? landing : s;
  const place = usePoll((signal) => (target ? api<Place | null>(qs("/api/core/reverse", { lat: target.lat.toFixed(3), lon: target.lon.toFixed(3) }), { signal }) : Promise.resolve(null)), null, [target?.lat.toFixed(3), target?.lon.toFixed(3)], !target);

  const look = here ? lookAngle(here, p) : null;
  const toTarget = here && target ? bearingDeg(here, target) : null;
  const burstAlt = track.data?.burst?.altM ?? s.prediction?.burst?.altM ?? null;
  const ageS = Math.round((now - s.seenAt) / 1000);

  return (
    <ProfilerCard
      band={flying ? "Weather balloon · live" : "Weather balloon · down"}
      tone="sodium"
      name={s.serial}
      kicker={`${modelName(s)} radiosonde`}
      loading={track.loading && !track.data}
      onClose={onClose}
      rows={[
        ["Status", status(s, ageS, units)],
        [s.phase === "ground" ? "Elevation" : "Altitude", flying || s.phase === "ground" ? altitudeLabel(p.altM, units) : `${altitudeLabel(s.altM, units)} when last heard`],
        flying && s.speedMs !== null && ["Drifting at", `${fmt.speedKnots(s.speedMs * KT_PER_MS, units)}${s.headingDeg !== null ? ` toward ${compassPoint(s.headingDeg)}` : ""}`],
        s.tempC !== null && ["Air temperature", fmt.temp(s.tempC, units)],
        s.humidityPct !== null && ["Humidity", `${Math.round(s.humidityPct)} %`],
        s.pressureHpa !== null && ["Air pressure", `${fmt.one(s.pressureHpa)} hPa`],
        s.frequencyMHz !== null && ["Radio frequency", `${s.frequencyMHz} MHz`],
        s.battV !== null && ["Battery", `${fmt.one(s.battV)} V`],
        track.data?.launch.site && ["Launched from", `${track.data.launch.site.name} · ${fmt.clock(track.data.launch.at)}`],
        burstAlt !== null && [track.data?.burst ? "Burst at" : "Burst predicted", altitudeLabel(burstAlt, units)],
        landing && flying && ["Landing", `${fmt.clock(landing.at)} · ${fmt.until(landing.at, now)}${place.data ? ` · near ${place.data.area || place.data.name}` : ""}`],
        !flying && target && ["Last heard near", place.data ? place.data.area || place.data.name : `${fmt.coord(s.lat, s.lon)}`],
        look && ["From you", `${fmt.distance(look.rangeM, units)} ${compassPoint(look.az)}${flying ? ` · ${look.el > 0 ? `${Math.round(look.el)}° up` : "below your horizon"}` : ""}`],
        here && target && flying && toTarget !== null && ["Landing from you", `${fmt.distance(distanceM(here, target), units)} ${compassPoint(toTarget)}`],
        (flying || lost) && ["Last frame", lost ? `${fmt.ago(s.seenAt, now)} · no longer in the feed` : fmt.ago(s.seenAt, now)],
      ]}
      fact={fact(s)}
      actions={
        <>
          {target && (
            <Button size="sm" icon={<Navigation size={13} />} onClick={() => void routeTo({ lat: target.lat, lon: target.lon, name: `sonde ${s.serial}` }, "car")}>
              {flying ? "Route to the landing point" : "Route to where it landed"}
            </Button>
          )}
          <Button size="sm" variant="ghost" icon={<Layers size={13} />} onClick={() => showLayer("sondes.live")}>
            Show on map
          </Button>
          <a className="v-btn v-btn--sm v-btn--ghost" href={`https://sondehub.org/${encodeURIComponent(s.serial)}`} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> SondeHub
          </a>
        </>
      }
      source="Radiosonde telemetry decoded and shared by SondeHub volunteers"
    >
      {track.data && <FlightProfile sonde={s} track={track.data} now={now} units={units} />}
    </ProfilerCard>
  );
}

function status(s: Sonde, ageS: number, units: "metric" | "imperial"): string {
  const rate = s.vertMs === null ? "" : ` at ${units === "imperial" ? `${fmt.int(Math.abs(s.vertMs) * 3.28084)} ft/s` : `${fmt.one(Math.abs(s.vertMs))} m/s`}`;
  switch (s.phase) {
    case "ascending":
      return `Climbing${rate}`;
    case "descending":
      return `Falling${rate}`;
    case "floating":
      return "Floating at altitude";
    case "ground":
      return ageS > 240 ? `Landed, last heard ${fmt.ago(s.seenAt)}` : "On the ground, still transmitting";
    case "lost":
      return `Signal lost ${fmt.ago(s.seenAt)}`;
  }
}

function fact(s: Sonde): string {
  const hear = s.frequencyMHz === null ? "" : `You can hear it with a cheap SDR on ${s.frequencyMHz} MHz. `;
  if (s.phase === "ground") return `${hear}Radiosondes are single-use. Most carry a label with return instructions.`;
  if (s.phase === "lost") return `${hear}No receiver has heard it since, so it may have come down out of range.`;
  if (s.phase === "descending") return `${hear}The balloon has burst, and most sondes fall on a small parachute.`;
  return `${hear}Each frame carries its GPS position, so volunteers across the continent can follow it all the way down.`;
}
