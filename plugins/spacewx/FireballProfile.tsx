import { ExternalLink, Layers } from "lucide-react";
import type { ReactElement } from "react";
import { api, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import type { Place } from "../../shared/location";
import { showLayer } from "../city/client";

/** Energy of the Hiroshima bomb, kilotons of TNT: the usual yardstick for a fireball's yield. */
const HIROSHIMA_KT = 15;

function energy(kt: number): string {
  return kt >= 1 ? `${kt >= 10 ? fmt.int(kt) : fmt.one(kt)} kt TNT` : `${fmt.int(kt * 1000)} t TNT`;
}

function elapsed(at: number): string {
  const days = (Date.now() - at) / 86_400_000;
  if (days < 2) return fmt.ago(at);
  if (days < 60) return `${Math.round(days)} days ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${Math.floor(days / 365.25)} years ago`;
}

function comparison(kt: number): string {
  const ratio = kt / HIROSHIMA_KT;
  if (ratio >= 1.5) return `about ${fmt.int(ratio)} times the Hiroshima bomb`;
  if (ratio >= 0.9) return "about as much as the Hiroshima bomb";
  return `about ${Math.max(1, Math.round(ratio * 100))} % of the Hiroshima bomb`;
}

/** Profiler for one fireball: when and where it flared, how much energy it released, and how fast it came in. */
export default function FireballProfile({ entity, onClose }: ProfilerProps<"fireball">): ReactElement {
  const f = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const place = usePoll((signal) => api<Place | null>(qs("/api/core/reverse", { lat: f.lat.toFixed(2), lon: f.lon.toFixed(2) }), { signal }), null, [f.id]);
  const when = new Date(f.at);

  return (
    <ProfilerCard
      band="Fireball"
      tone="sodium"
      name={energy(f.kt)}
      kicker={when.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}
      onClose={onClose}
      rows={[
        ["When", `${when.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC · ${elapsed(f.at)}`],
        ["Impact energy", `${energy(f.kt)} · ${comparison(f.kt)}`],
        ["Light radiated", `${(f.radiatedJ / 1e9).toLocaleString("en-US", { maximumSignificantDigits: 3 })} GJ`],
        f.altKm !== null && ["Altitude", `${fmt.distance(f.altKm * 1000, units)} at peak brightness`],
        f.velKmS !== null && ["Entry speed", `${fmt.one(f.velKmS)} km/s · ${fmt.speedKnots(f.velKmS * 1943.84, units)}`],
        ["Over", place.data ? place.data.context || place.data.name : `${Math.abs(f.lat).toFixed(1)}°${f.lat >= 0 ? "N" : "S"} ${Math.abs(f.lon).toFixed(1)}°${f.lon >= 0 ? "E" : "W"}`],
        here && ["From you", `${fmt.distance(distanceM(here, f), units)} ${compassPoint(bearingDeg(here, f))}`],
      ]}
      fact={fact(f.kt, f.altKm)}
      actions={
        <>
          <Button size="sm" variant="ghost" icon={<Layers size={13} />} onClick={() => showLayer("spacewx.fireballs")}>
            Show on map
          </Button>
          <a className="v-btn v-btn--sm v-btn--ghost" href="https://cneos.jpl.nasa.gov/fireballs/" target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> NASA CNEOS
          </a>
        </>
      }
      source="NASA/JPL CNEOS · detected by U.S. government sensors"
    />
  );
}

function fact(kt: number, altKm: number | null): string {
  if (kt >= 100) return "An airburst this size can break windows on the ground below. Few events in the sensors' record are this large.";
  if (kt >= 10) return "Most of the energy went into a single airburst, far above the ground, which is why events this size seldom leave craters.";
  if (altKm !== null && altKm < 25) return "It burned up unusually low in the atmosphere, below where most fireballs flare.";
  return "Space rock hits the atmosphere every day. Most burn up unseen over the ocean, and sensors on satellites record only the brightest.";
}
