import { degreesLat, degreesLong, ecfToLookAngles, eciToEcf, eciToGeodetic, gstime, jday, propagate, shadowFraction, sunPos, twoline2satrec, type SatRec } from "satellite.js";
import { useMemo } from "react";
import { api } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { LatLon } from "../../shared/geo";
import { sun } from "../astro/client";
import type { SatGroup, SatelliteRef, TleSet } from "./types";

/** Orbital mechanics for satellites, computed on this Mac with the SGP4 model (satellite.js). */

export interface Sat {
  ref: SatelliteRef;
  rec: SatRec;
}

const SIX_HOURS = 6 * 3_600_000;

/** Two-line element sets for one CelesTrak group, parsed into propagators. */
export function useSats(group: SatGroup, enabled = true): Polled<TleSet> & { sats: Sat[] } {
  const poll = usePoll((signal) => api<TleSet>(`/api/satellites/tle?group=${group}`, { signal }), SIX_HOURS, [group], !enabled);
  const sats = useMemo(() => (poll.data ? poll.data.tles.map((t) => ({ ref: { ...t, group }, rec: twoline2satrec(t.line1, t.line2) })) : []), [poll.data, group]);
  return { ...poll, sats };
}

export function satFromRef(ref: SatelliteRef): Sat {
  return { ref, rec: twoline2satrec(ref.line1, ref.line2) };
}

export interface SatState {
  lat: number;
  lon: number;
  altKm: number;
  speedKmS: number;
  sunlit: boolean;
}

export function stateAt(rec: SatRec, date: Date): SatState | null {
  const pv = propagate(rec, date);
  if (!pv) return null;
  const geo = eciToGeodetic(pv.position, gstime(date));
  const v = pv.velocity;
  const sunlit = shadowFraction(sunPos(jday(date)).rsun, pv.position) < 0.5;
  return { lat: degreesLat(geo.latitude), lon: degreesLong(geo.longitude), altKm: geo.height, speedKmS: Math.hypot(v.x, v.y, v.z), sunlit };
}

export interface Look {
  az: number;
  el: number;
  rangeKm: number;
}

/** Where to look for the satellite from `observer` at `date`. */
export function lookFrom(rec: SatRec, observer: LatLon, date: Date): Look | null {
  const pv = propagate(rec, date);
  if (!pv) return null;
  const ecf = eciToEcf(pv.position, gstime(date));
  const look = ecfToLookAngles({ latitude: (observer.lat * Math.PI) / 180, longitude: (observer.lon * Math.PI) / 180, height: 0 }, ecf);
  return { az: (look.azimuth * 180) / Math.PI, el: (look.elevation * 180) / Math.PI, rangeKm: look.rangeSat };
}

/** Orbital period in minutes, from the mean motion (radians per minute). */
export function periodMin(rec: SatRec): number {
  return (2 * Math.PI) / rec.no;
}

export function inclinationDeg(rec: SatRec): number {
  return (rec.inclo * 180) / Math.PI;
}

export interface Pass {
  rise: Date;
  riseAz: number;
  peak: Date;
  peakEl: number;
  peakAz: number;
  set: Date;
  setAz: number;
  /** True when the satellite is sunlit at its peak while your sky is dark — you can see it with your eyes. */
  visible: boolean;
}

/** Find a crossing of `minEl` between two times by bisection, to the second. */
function crossing(rec: SatRec, observer: LatLon, lo: number, hi: number, minEl: number, rising: boolean): number {
  let a = lo;
  let b = hi;
  while (b - a > 1000) {
    const mid = (a + b) / 2;
    const el = lookFrom(rec, observer, new Date(mid))?.el ?? -90;
    if (el >= minEl === rising) b = mid;
    else a = mid;
  }
  return (a + b) / 2;
}

/** Passes above `minEl` degrees in the next `hours`, stepping 30 s and refining edges to one second. */
export function passes(rec: SatRec, observer: LatLon, from: Date, hours: number, minEl = 10): Pass[] {
  const out: Pass[] = [];
  const step = 30_000;
  const end = from.getTime() + hours * 3_600_000;
  let prevEl = lookFrom(rec, observer, from)?.el ?? -90;
  let riseAt: number | null = prevEl >= minEl ? from.getTime() : null;
  let peak = { t: from.getTime(), el: prevEl, az: 0 };
  for (let t = from.getTime() + step; t <= end; t += step) {
    const look = lookFrom(rec, observer, new Date(t));
    const el = look?.el ?? -90;
    if (riseAt === null && el >= minEl && prevEl < minEl) {
      riseAt = crossing(rec, observer, t - step, t, minEl, true);
      peak = { t, el, az: look?.az ?? 0 };
    }
    if (riseAt !== null) {
      if (el > peak.el) peak = { t, el, az: look?.az ?? 0 };
      if (el < minEl && prevEl >= minEl) {
        const setAt = crossing(rec, observer, t - step, t, minEl, false);
        const riseLook = lookFrom(rec, observer, new Date(riseAt));
        const setLook = lookFrom(rec, observer, new Date(setAt));
        const peakDate = new Date(peak.t);
        const state = stateAt(rec, peakDate);
        out.push({
          rise: new Date(riseAt),
          riseAz: riseLook?.az ?? 0,
          peak: peakDate,
          peakEl: peak.el,
          peakAz: peak.az,
          set: new Date(setAt),
          setAz: setLook?.az ?? 0,
          visible: Boolean(state?.sunlit) && sun(observer.lat, observer.lon, peakDate).el < -6,
        });
        riseAt = null;
        peak = { t: 0, el: -90, az: 0 };
      }
    }
    prevEl = el;
  }
  return out;
}

/** Short, friendly names for the stations people care about. */
export function displayName(name: string): string {
  if (name.startsWith("ISS (ZARYA)")) return "ISS";
  if (name.startsWith("CSS (TIANHE)")) return "Tiangong";
  return name.replace(/\s+/g, " ").trim();
}

/** Of CelesTrak's "stations" group, the crewed stations themselves (the rest are docked modules and debris). */
export const CREWED = (name: string): boolean => name.startsWith("ISS (ZARYA)") || name.startsWith("CSS (TIANHE)");
