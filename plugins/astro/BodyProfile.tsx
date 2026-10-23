import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { Empty, ProfilerCard } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import { moon, moonTimes, sun, sunTimes } from "./bodies";
import { LIGHT_YEARS } from "./distances";
import { starPosition } from "./stars";

const time = (d: Date | null): string => (d ? fmt.clock(d.getTime()) : "—");
const where = (az: number, el: number): string => (el >= 0 ? `${Math.round(el)}° up, ${compassPoint(az)} (${Math.round(az)}°)` : `Below the horizon, ${compassPoint(az)}`);

/** Profiler for the Sun, the Moon and bright stars. */
export default function BodyProfile({ entity, onClose }: ProfilerProps<"body">): ReactElement {
  const here = useLocation((s) => s.here);
  const now = useNow(10_000);
  if (!here) return <Empty title="Location needed">Positions in the sky depend on where you stand.</Empty>;
  const b = entity.data;
  const date = new Date(now);

  if (b.body === "sun") {
    const s = sun(here.lat, here.lon, date);
    const t = sunTimes(here.lat, here.lon, date);
    const dayMs = t.sunrise && t.sunset ? t.sunset.getTime() - t.sunrise.getTime() : null;
    const next = t.sunset && t.sunset.getTime() > now ? `Sunset ${fmt.until(t.sunset.getTime(), now)}` : t.sunrise && t.sunrise.getTime() > now ? `Sunrise ${fmt.until(t.sunrise.getTime(), now)}` : null;
    const shadow = s.el > 1 && s.el < 80 ? 1 / Math.tan((s.el * Math.PI) / 180) : null;
    return (
      <ProfilerCard
        band="Star profile"
        tone="sodium"
        name="Sun"
        kicker={next ?? "Our star"}
        onClose={onClose}
        rows={[
          ["Position", where(s.az, s.el)],
          ["Sunrise", time(t.sunrise)],
          ["Solar noon", time(t.solarNoon)],
          ["Golden hour", time(t.goldenHour)],
          ["Sunset", time(t.sunset)],
          dayMs !== null && ["Daylight", fmt.duration(dayMs / 1000)],
        ]}
        fact={
          shadow !== null
            ? `Right now your shadow is ${shadow.toFixed(1)} times your height. Sunlight left the Sun 8 minutes and 20 seconds ago.`
            : "Sunlight takes 8 minutes and 20 seconds to reach you."
        }
        source="Computed on this Mac (SunCalc)"
      />
    );
  }

  if (b.body === "moon") {
    const m = moon(here.lat, here.lon, date);
    const t = moonTimes(here.lat, here.lon, date);
    return (
      <ProfilerCard
        band="Moon profile"
        tone="ice"
        name="Moon"
        kicker={`${m.phaseName} · ${Math.round(m.illumination * 100)}% lit`}
        onClose={onClose}
        rows={[
          ["Position", where(m.az, m.el)],
          ["Moonrise", t.alwaysUp ? "Up all day" : t.alwaysDown ? "Not today" : time(t.rise)],
          ["Moonset", t.alwaysUp ? "Up all day" : t.alwaysDown ? "Not today" : time(t.set)],
          ["Distance", `${fmt.int(m.distanceKm)} km`],
        ]}
        fact={`Moonlight left the Moon ${(m.distanceKm / 299_792).toFixed(2)} seconds ago.`}
        source="Computed on this Mac (SunCalc)"
      />
    );
  }

  const p = starPosition(b.raH ?? 0, b.decDeg ?? 0, here.lat, here.lon, date);
  const ly = LIGHT_YEARS[b.name];
  return (
    <ProfilerCard
      band="Star profile"
      tone="ice"
      name={b.name}
      kicker={`Magnitude ${b.mag?.toFixed(2) ?? "?"}${ly ? ` · ${fmt.int(ly)} light years` : ""}`}
      onClose={onClose}
      rows={[
        ["Position", where(p.az, p.el)],
        ["Right ascension", `${Math.floor(b.raH ?? 0)}h ${Math.round(((b.raH ?? 0) % 1) * 60)}m`],
        ["Declination", `${(b.decDeg ?? 0).toFixed(1)}°`],
      ]}
      fact={
        ly
          ? `The light you see tonight left ${b.name} about ${fmt.int(ly)} years ago${ly < 2000 ? `, around the year ${Math.round(new Date().getFullYear() - ly)}` : ""}.`
          : `${b.name} is one of the brightest stars in the night sky.`
      }
      source="Yale Bright Star Catalogue · computed on this Mac"
    />
  );
}
