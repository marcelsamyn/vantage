import { Radiation, Volume2, Wind, type LucideIcon } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchSensors, LEVEL_TONE, LEVEL_WORD, showValue } from "./client";
import { KIND_TITLE } from "./scales";
import type { Sensor, SensorKind } from "./types";

/** Kilometres added to the request, so the grid point the server searches from still covers your radius. */
const SNAP_MARGIN_KM = 2;

const ICON: Record<SensorKind, LucideIcon> = { air: Wind, noise: Volume2, radiation: Radiation };

/** A reading older than this is the sensor's last word, not what the air or the street is like now. */
export const STALE_MS = 3 * 3_600_000;

/**
 * The nearest sensor that still reports, with its reading. Safecast surveys are walks from the past, so they never
 * count as a reading near you.
 */
export function sensorItems(kind: SensorKind, sensors: readonly Sensor[], at: LatLon, radiusM: number, now: number): NearbyItem[] {
  const nearest = sensors
    .filter((s) => s.kind === kind && s.live && Number.isFinite(s.value) && now - s.at <= STALE_MS)
    .map((s) => ({ s, d: distanceM(at, s) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)[0]?.s;
  if (!nearest) return [];
  const entity = { kind: "sensor", id: nearest.id, data: nearest } as const;
  return [
    {
      id: nearest.id,
      title: nearest.name ?? `${KIND_TITLE[kind]} sensor`,
      detail: `${showValue(nearest)} ${nearest.unit} · ${LEVEL_WORD[nearest.level]}`,
      kind: "see",
      at: { lat: nearest.lat, lon: nearest.lon },
      icon: ICON[kind],
      tone: LEVEL_TONE[nearest.level],
      live: true,
      entity,
      primary: { label: "Show reading", run: () => profile.open(entity) },
      more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: nearest.lat, lon: nearest.lon, ...(nearest.name ? { name: nearest.name } : {}) }, "foot")) }],
    },
  ];
}

/** The map layer's own route: the server shares one upstream answer between the layer and this list. */
export const sensorNearby =
  (kind: SensorKind): NearbyProvider =>
  // The server asks upstream around a 0.02° grid point, up to 1.4 km from you, so the request reaches past the radius.
  async ({ at, radiusM, now }, signal) =>
    sensorItems(kind, (await fetchSensors(kind, at, Math.ceil(radiusM / 1000) + SNAP_MARGIN_KM, signal)).sensors, at, radiusM, now);
