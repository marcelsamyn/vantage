import * as SunCalc from "suncalc";

/** Sun and Moon positions and times for an observer. SunCalc 2 reports degrees, azimuth clockwise from north. */

export interface Body {
  az: number;
  el: number;
}

export function sun(lat: number, lon: number, date = new Date()): Body {
  const p = SunCalc.getPosition(date, lat, lon);
  return { az: p.azimuth, el: p.altitude };
}

export function moon(lat: number, lon: number, date = new Date()): Body & { distanceKm: number; illumination: number; phase: number; phaseName: string } {
  const p = SunCalc.getMoonPosition(date, lat, lon);
  const i = SunCalc.getMoonIllumination(date);
  return { az: p.azimuth, el: p.altitude, distanceKm: p.distance, illumination: i.fraction, phase: i.phase, phaseName: phaseName(i.phase) };
}

export function phaseName(phase: number): string {
  if (phase < 0.03 || phase > 0.97) return "New moon";
  if (phase < 0.22) return "Waxing crescent";
  if (phase < 0.28) return "First quarter";
  if (phase < 0.47) return "Waxing gibbous";
  if (phase < 0.53) return "Full moon";
  if (phase < 0.72) return "Waning gibbous";
  if (phase < 0.78) return "Last quarter";
  return "Waning crescent";
}

export interface SunTimes {
  dawn: Date | null;
  sunrise: Date | null;
  goldenHourEnd: Date | null;
  solarNoon: Date | null;
  goldenHour: Date | null;
  sunset: Date | null;
  dusk: Date | null;
}

const valid = (d: Date | null | undefined): Date | null => (d && !Number.isNaN(d.getTime()) ? d : null);

export function sunTimes(lat: number, lon: number, date = new Date()): SunTimes {
  const t = SunCalc.getTimes(date, lat, lon);
  return {
    dawn: valid(t.dawn),
    sunrise: valid(t.sunrise),
    goldenHourEnd: valid(t.goldenHourEnd),
    solarNoon: valid(t.solarNoon),
    goldenHour: valid(t.goldenHour),
    sunset: valid(t.sunset),
    dusk: valid(t.dusk),
  };
}

export function moonTimes(lat: number, lon: number, date = new Date()): { rise: Date | null; set: Date | null; alwaysUp: boolean; alwaysDown: boolean } {
  const t = SunCalc.getMoonTimes(date, lat, lon);
  return { rise: valid(t.rise), set: valid(t.set), alwaysUp: Boolean(t.alwaysUp), alwaysDown: Boolean(t.alwaysDown) };
}
