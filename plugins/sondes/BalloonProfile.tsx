import { Layers } from "lucide-react";
import type { ReactElement } from "react";
import { api, qs } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import type { Place } from "../../shared/location";
import { showLayer } from "../city/client";
import { BalloonChart, sunlit } from "./BalloonChart";
import { altitudeLabel, bandName, BALLOON_STALE_MS, fetchBalloonFlight } from "./client";
import type { AmateurBalloon, AmateurFlight } from "./types";

const KT_PER_MS = 1.94384;
const EARTH_CIRCUMFERENCE_KM = 40_075;

/** Profiler for a balloon launched by radio amateurs. It names the balloon by its radio link, never by its owner. */
export default function BalloonProfile({ entity, onClose }: ProfilerProps<"amateurballoon">): ReactElement {
  const b = entity.data;
  const units = useSettings((s) => s.units);
  const now = useNow(1000);
  const flight = usePoll((signal) => fetchBalloonFlight(b.id, signal), null, [b.id]);
  const place = usePoll((signal) => api<Place | null>(qs("/api/core/reverse", { lat: b.lat.toFixed(2), lon: b.lon.toFixed(2) }), { signal }), null, [b.lat.toFixed(2), b.lon.toFixed(2)]);

  const stale = now - b.seenAt > BALLOON_STALE_MS;
  const band = bandName(b.frequencyMHz);
  const daylight = sunlit(now, b.lat, b.lon, b.altM);
  const over = place.data ? [place.data.area || place.data.name, place.data.context].filter(Boolean).join(", ") : null;

  return (
    <ProfilerCard
      band={stale ? "Amateur balloon · quiet" : "Amateur balloon · live"}
      tone="sodium"
      name={b.name}
      kicker={b.daysAloft !== null ? `Floating for ${fmt.int(b.daysAloft)} days` : "Drifting in the stratosphere"}
      loading={flight.loading && !flight.data}
      onClose={onClose}
      rows={[
        ["Altitude", altitudeLabel(b.altM, units)],
        b.speedMs !== null && ["Drifting at", fmt.speedKnots(b.speedMs * KT_PER_MS, units)],
        ["Over", over ?? fmt.coord(b.lat, b.lon)],
        ["Last heard", `${fmt.ago(b.seenAt, now)}${stale ? " · no receiver has heard it since" : ""}`],
        ["Sun", daylight ? "In daylight, so the solar cell is charging" : "In the dark, running on stored charge"],
        b.daysAloft !== null && ["Days aloft", `${fmt.int(b.daysAloft)}${b.launchDate ? ` · launched ${b.launchDate}` : ""}`],
        b.daysAloft === null && flight.data && flight.data.spanDays >= 0.1 && ["Heard for", flightSpan(flight.data)],
        flight.data && Math.abs(flight.data.laps) >= 0.05 && ["Laps of the Earth", lapsLine(flight.data)],
        b.tempC !== null && ["Tracker temperature", fmt.temp(b.tempC, units)],
        ["Radio link", `${b.link}${b.frequencyMHz !== null ? ` · ${b.frequencyMHz.toFixed(3)} MHz${band ? ` · ${band} band` : ""}` : ""}`],
      ]}
      fact={fact(b)}
      actions={
        <Button
          size="sm"
          variant="ghost"
          icon={<Layers size={13} />}
          onClick={() => showLayer("sondes.amateur")}
        >
          Show on map
        </Button>
      }
      source="Amateur balloon positions from SondeHub, sent by WSPR and APRS gateways. The balloon's owner is not shown."
    >
      <BalloonChart track={b.track} units={units} />
    </ProfilerCard>
  );
}

function flightSpan(f: AmateurFlight): string {
  return f.spanDays >= 365 ? "a year or more" : `${fmt.int(f.spanDays)} days`;
}

function lapsLine(f: AmateurFlight): string {
  const direction = f.laps > 0 ? "eastward" : "westward";
  return `${fmt.one(Math.abs(f.laps))} ${direction} in ${f.spanDays >= 365 ? "the past year" : `${fmt.int(f.spanDays)} days`}`;
}

function fact(b: AmateurBalloon): string {
  if (b.speedMs !== null && b.speedMs > 1) {
    const km = EARTH_CIRCUMFERENCE_KM * Math.cos((Math.abs(b.lat) * Math.PI) / 180);
    const days = km / (b.speedMs * 3.6 * 24);
    return `At ${fmt.one(b.speedMs * 3.6)} km/h along its parallel of latitude, one lap of the Earth would take ${days < 2 ? "about a day" : `${fmt.int(days)} days`}. The wind carries it; nothing steers it.`;
  }
  return "Nothing steers it. The wind at this height carries it, and a small solar cell powers a tracker light enough for a party balloon to lift.";
}
