import { X } from "lucide-react";
import { motion } from "motion/react";
import { LngLatBounds, type Map as MapLibreMap, type PaddingOptions } from "maplibre-gl";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useAmbientMotion, useInterval } from "../../app/core/hooks";
import { useSettings } from "../../app/core/settings";
import { IconButton, Tag } from "../../app/ui";
import type { Rect } from "./around";
import { MAP_INK, useGeoJsonLayer } from "./layer-kit";
import { useCity } from "./store";
import type { TravelMode } from "./types";

const MODE: Record<TravelMode, string> = { foot: "Walk", bike: "Cycle", car: "Drive" };
const DASH_FRAMES = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

/** Room left around a fitted route, inside the free part of the map. */
const ROUTE_MARGIN = 40;

/**
 * Padding for fitting a route into `frame`. MapLibre adds the map's own padding (set by "Around me") to the padding
 * given here, so only the rest is passed.
 */
function routePadding(map: MapLibreMap, frame: Rect | null): PaddingOptions {
  const canvas = map.getCanvas();
  const inset = frame
    ? { top: frame.top, left: frame.left, right: canvas.clientWidth - frame.right, bottom: canvas.clientHeight - frame.bottom }
    : { top: 0, left: 0, right: 0, bottom: 0 };
  const own = map.getPadding();
  const side = (k: keyof PaddingOptions): number => Math.max(0, inset[k] + ROUTE_MARGIN - (own[k] ?? 0));
  return { top: side("top"), left: side("left"), right: side("right"), bottom: side("bottom") };
}

/** The active route: a glowing line with a dash that flows toward the destination. */
export function RouteLayer({ map }: { map: MapLibreMap }): ReactElement | null {
  const route = useCity((s) => s.route);
  const setRoute = useCity((s) => s.setRoute);
  const units = useSettings((s) => s.units);

  const data = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!route) return null;
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.line } }] };
  }, [route]);

  useGeoJsonLayer(map, {
    id: "city-route",
    data,
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-glow`, type: "line", source, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": 12, "line-opacity": 0.14, "line-blur": 6 } },
      { id: `${source}-core`, type: "line", source, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": MAP_INK.ice, "line-width": 2.5, "line-opacity": 0.55 } },
      { id: `${source}-flow`, type: "line", source, layout: { "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 2.5, "line-dasharray": [0, 4, 3] } },
    ],
  });

  // Fit the route into the part of the map no panel covers when a new one arrives. It is your own navigation, so
  // "Around me" stops following you while you look at it.
  useEffect(() => {
    if (!route) return;
    const bounds = route.line.reduce((b, c) => b.extend(c), new LngLatBounds(route.line[0], route.line[0]));
    // A walk of a few steps would otherwise fill the screen at building scale.
    map.fitBounds(bounds, { padding: routePadding(map, useCity.getState().frame), pitch: 45, maxZoom: 17, duration: 1400 }, { userNavigation: true });
  }, [map, route]);

  // Animate the dash at ~12 fps while someone watches; cheap, and enough to read as motion. At rest it holds still.
  const ambient = useAmbientMotion();
  const step = useRef(0);
  useInterval(
    () => {
      step.current = (step.current + 1) % DASH_FRAMES.length;
      if (map.getLayer("city-route-flow")) map.setPaintProperty("city-route-flow", "line-dasharray", DASH_FRAMES[step.current]);
    },
    route && ambient ? 80 : null,
  );

  if (!route) return null;
  return (
    <motion.div className="city-route" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.4, bounce: 0 }}>
      <Tag tone="ice">{MODE[route.mode]}</Tag>
      <span className="num">{fmt.distance(route.distanceM, units)}</span>
      <span className="faint">·</span>
      <span className="num">{fmt.duration(route.durationS)}</span>
      <IconButton label="Clear route" onClick={() => setRoute(null)}>
        <X size={14} />
      </IconButton>
    </motion.div>
  );
}
