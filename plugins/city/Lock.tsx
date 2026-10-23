import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAnimationFrame, usePrefersReducedMotion } from "../../app/core/hooks";
import type { LatLon } from "../../shared/geo";
import { footprintsAt, type Solid } from "./footprint";
import { MAP_INK, useDomMarkers, useGeoJsonLayer } from "./layer-kit";
import { BUILDINGS_LAYER } from "./style";

/** How long a lit building takes to rise from the ground to its roof. */
const RISE_MS = 560;

const RETICLE = '<svg class="city-lock__frame" viewBox="0 0 44 44"><path d="M1 12V1h11M32 1h11v11M43 32v11H32M12 43H1V32"/></svg><span class="city-lock__dot"></span>';

/**
 * The spot you are looking into: the point the context menu or a place profile is about. Once the camera rests
 * there, a reticle closes in on it and the building that stands on it lights up from the ground, so you can see
 * which structure the profile describes.
 */
export function LockOn({ map, at }: { map: MapLibreMap; at: LatLon | null }): null {
  const spot = useSettled(map, at);
  const spots = useMemo(() => (spot ? [spot] : []), [spot]);
  useDomMarkers(map, spots, {
    id: (s) => `${s.lat},${s.lon}`,
    at: (s) => s,
    build: () => {
      const element = document.createElement("div");
      element.className = "city-lock";
      element.innerHTML = RETICLE;
      return { element, update: () => undefined };
    },
    // The reticle lets clicks through to the map, so this never runs.
    onClick: () => undefined,
  });
  useLitBuilding(map, spot);
  return null;
}

/** `at` once the camera has come to rest, so a search's reticle plays when the flight arrives, not while it leaves. */
function useSettled(map: MapLibreMap, at: LatLon | null): LatLon | null {
  const lat = at?.lat;
  const lon = at?.lon;
  const [settled, setSettled] = useState<LatLon | null>(null);
  useEffect(() => {
    setSettled(null);
    if (lat === undefined || lon === undefined) return;
    const show = (): void => setSettled({ lat, lon });
    if (!map.isMoving()) {
      show();
      return;
    }
    map.once("moveend", show);
    return () => {
      map.off("moveend", show);
    };
  }, [map, lat, lon]);
  return settled;
}

/** The building parts that stand on `spot`, drawn in ice over the dark city and rising from the ground once. */
function useLitBuilding(map: MapLibreMap, spot: LatLon | null): void {
  const reduced = usePrefersReducedMotion();
  const [solids, setSolids] = useState<GeoJSON.FeatureCollection<GeoJSON.Polygon, Solid> | null>(null);
  const [rise, setRise] = useState(1);
  const started = useRef<number | null>(null);

  useEffect(() => {
    setSolids(null);
    if (!spot) return;
    // Off screen, zoomed out past the buildings, or with its tiles still on their way, the spot finds nothing yet:
    // look again each time the map settles, until a building turns up.
    const find = (): void => {
      if (!map.getLayer(BUILDINGS_LAYER)) return;
      const found = footprintsAt(map.queryRenderedFeatures(map.project([spot.lon, spot.lat]), { layers: [BUILDINGS_LAYER] }), spot);
      if (found.features.length === 0) return;
      map.off("idle", find);
      started.current = null;
      setRise(0);
      setSolids(found);
    };
    map.on("idle", find);
    if (map.areTilesLoaded()) find();
    return () => {
      map.off("idle", find);
    };
  }, [map, spot]);

  useAnimationFrame(
    (_dt, _clock, now) => {
      started.current ??= now;
      setRise(Math.min(1, (now - started.current) / RISE_MS));
    },
    solids !== null && rise < 1 && !reduced,
    "data",
    30,
  );

  const data = useMemo(() => {
    if (!solids) return null;
    // Fast off the ground, settling at the roof.
    const k = reduced ? 1 : 1 - (1 - rise) ** 3;
    return { ...solids, features: solids.features.map((f) => ({ ...f, properties: { base: f.properties.base, top: f.properties.base + (f.properties.top - f.properties.base) * k } })) };
  }, [solids, rise, reduced]);

  useGeoJsonLayer(map, {
    id: "city-lit",
    data,
    belowLabels: true,
    layers: (source) => [
      {
        id: `${source}-solid`,
        type: "fill-extrusion",
        source,
        paint: {
          "fill-extrusion-color": MAP_INK.ice,
          // Flat below zoom 13 and rising to full height by 14.5, like the buildings it lights.
          "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, ["get", "top"]],
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-opacity": 0.85,
          "fill-extrusion-vertical-gradient": true,
        },
      },
    ],
  });
}
