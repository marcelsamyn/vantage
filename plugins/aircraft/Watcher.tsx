import { useEffect, useRef } from "react";
import { api, qs } from "../../app/core/api";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation, type Here } from "../../app/core/location";
import { useSettings, type Units } from "../../app/core/settings";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import type { Place } from "../../shared/location";
import { AROUND_NM, fetchDetails, fetchEmergencies, fetchNear, useCircling, useEmergencies, useTraffic, type Circling } from "./client";
import { emergencyOf } from "./emergency";
import { detectLoiter, remember, type FixHistory } from "./loiter";
import { categoryName } from "./models";
import { describeAircraft } from "./operator";
import type { Aircraft } from "./types";

const POLL_MS = 10_000;
const EMERGENCY_POLL_MS = 60_000;
/** An emergency this close to you is worth a toast. */
const TOAST_RANGE_M = 500_000;

/** Keeps `useTraffic` fresh and reports notable aircraft near you, and emergencies anywhere, to the feed. */
export default function AircraftWatcher(): null {
  const here = useLocation((s) => s.here);
  const center = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const { data, error } = usePoll((signal) => (here ? fetchNear(here, AROUND_NM, signal) : Promise.reject(new Error("no location"))), POLL_MS, [center], !here);
  const world = usePoll((signal) => fetchEmergencies(signal), EMERGENCY_POLL_MS, []);
  const history = useRef<FixHistory>(new Map());
  const announced = useRef(new Map<string, number>());

  useEffect(() => {
    if (data) useTraffic.setState({ snapshot: data, error: null });
    else if (error) useTraffic.setState({ error: error.message });
  }, [data, error]);

  useEffect(() => {
    if (world.data) useEmergencies.setState({ snapshot: world.data, error: null });
    else if (world.error) useEmergencies.setState({ error: world.error.message });
  }, [world.data, world.error]);

  // Emergencies anywhere in the world. One feed event per aircraft and code.
  useEffect(() => {
    if (!world.data) return;
    const units = useSettings.getState().units;
    for (const a of world.data.aircraft) announceEmergency(a, world.data.fetchedAt, here, units);
  }, [world.data, here]);

  useEffect(() => {
    if (!data || !here) return;
    const units = useSettings.getState().units;
    for (const a of data.aircraft) {
      const d = distanceM(here, a);
      const where = `${fmt.distance(d, units)} ${compassPoint(bearingDeg(here, a))}`;
      const name = a.callsign ?? a.registration ?? a.hex.toUpperCase();
      const entity = { kind: "aircraft" as const, id: a.hex, data: { ...a, fetchedAt: data.fetchedAt } };
      // The nearby feed is ten times faster than the worldwide list; both share one feed key, so nothing repeats.
      if (emergencyOf(a)) announceEmergency(a, data.fetchedAt, here, units);
      else if (lowOverhead(a, d)) {
        feed({ level: "live", source: "aircraft", title: `${name} low overhead`, detail: `${a.altFt === null ? "" : `${fmt.int(a.altFt)} ft · `}${where}`, entity }, { key: `aircraft.low.${a.hex}`, dedupeMs: 20 * 60_000 });
      } else if (a.category === "A7" && d < 6000) {
        feed({ level: "live", source: "aircraft", title: `Helicopter ${name} nearby`, detail: where, entity }, { key: `aircraft.heli.${a.hex}`, dedupeMs: 30 * 60_000 });
      } else if (a.military && d < 40_000) {
        feed({ level: "info", source: "aircraft", title: `Military aircraft ${name} in range`, detail: `${categoryName(a.category) ?? "Aircraft"} · ${where}`, entity }, { key: `aircraft.mil.${a.hex}`, dedupeMs: 60 * 60_000 });
      }
    }

    // Circling: remember where each aircraft has been and look for the ones going round.
    remember(history.current, data, here);
    const byHex = new Map<string, Circling>();
    for (const [hex, fixes] of history.current) {
      const aircraft = data.aircraft.find((x) => x.hex === hex);
      const loiter = aircraft ? detectLoiter(fixes, data.fetchedAt) : null;
      if (aircraft && loiter) byHex.set(hex, { aircraft, fetchedAt: data.fetchedAt, loiter });
    }
    useCircling.setState({ byHex });
    for (const hex of announced.current.keys()) if (!byHex.has(hex)) announced.current.delete(hex);
    for (const circling of byHex.values()) {
      // Say it again every half hour so a long orbit stays in the feed.
      const bucket = Math.floor(circling.loiter.minutes / 30);
      if (announced.current.get(circling.aircraft.hex) === bucket) continue;
      announced.current.set(circling.aircraft.hex, bucket);
      void announceCircling(circling, here, units);
    }
  }, [data, here]);

  return null;
}

function lowOverhead(a: Aircraft, distance: number): boolean {
  return !a.onGround && a.altFt !== null && a.altFt < 6000 && distance < 4000;
}

function announceEmergency(a: Aircraft, fetchedAt: number, here: Here | null, units: Units): void {
  const emergency = emergencyOf(a);
  if (!emergency) return;
  const name = a.callsign ?? a.registration ?? a.hex.toUpperCase();
  const distance = here ? distanceM(here, a) : null;
  const where = here && distance !== null ? `${fmt.distance(distance, units)} ${compassPoint(bearingDeg(here, a))} of you` : fmt.coord(a.lat, a.lon);
  const hijack = emergency.code === "7500";
  feed(
    {
      level: "alert",
      source: "aircraft",
      title: hijack ? `${name} is squawking 7500 (the hijack code; often a mistake)` : `${name} is squawking ${emergency.code} (${emergency.title.toLowerCase()})`,
      detail: `${where}${a.altFt === null ? "" : ` · ${fmt.int(a.altFt)} ft`}`,
      entity: { kind: "aircraft", id: a.hex, data: { ...a, fetchedAt } },
    },
    // 7500 never raises a toast: pilots often set it by mistake.
    { key: `aircraft.emergency.${a.hex}.${emergency.code}`, dedupeMs: 6 * 3_600_000, toast: !hijack && distance !== null && distance <= TOAST_RANGE_M },
  );
}

async function reverse(lat: number, lon: number): Promise<Place | null> {
  try {
    return await api<Place | null>(qs("/api/core/reverse", { lat: lat.toFixed(3), lon: lon.toFixed(3) }));
  } catch {
    // The place name only decorates the event; without it the event gives the distance instead.
    return null;
  }
}

async function announceCircling({ aircraft: a, fetchedAt, loiter }: Circling, here: Here, units: Units): Promise<void> {
  const [place, details] = await Promise.all([reverse(loiter.center.lat, loiter.center.lon), fetchDetails(a).catch(() => undefined)]);
  const neighbourhood = place?.area.split(",")[0]?.trim() || place?.name;
  const where = neighbourhood ? `over ${neighbourhood}` : `${fmt.distance(distanceM(here, loiter.center), units)} ${compassPoint(bearingDeg(here, loiter.center))} of you`;
  const kind = describeAircraft(a, details);
  const callsign = a.callsign ?? a.registration;
  // A public body is already in the role ("Polizia di Stato helicopter"); every other owner follows it.
  const owner = details?.owner ?? a.ownerOperator;
  const ownedBy = owner && !kind.includes(owner) ? ` · ${owner}` : "";
  feed(
    {
      level: "live",
      source: "aircraft",
      title: `Circling ${where} for ${loiter.minutes} min${a.altFt === null ? "" : ` at ${fmt.int(a.altFt)} ft`}`,
      detail: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${callsign ? ` (${callsign})` : ""}${ownedBy} · ${fmt.distance(distanceM(here, loiter.center), units)} ${compassPoint(bearingDeg(here, loiter.center))} of you`,
      entity: { kind: "aircraft", id: a.hex, data: { ...a, fetchedAt } },
    },
    { key: `aircraft.loiter.${a.hex}.${Math.floor(loiter.minutes / 30)}`, dedupeMs: 45 * 60_000 },
  );
}
