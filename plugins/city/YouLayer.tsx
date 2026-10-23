import { Marker, type Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { unwrapDeg, useHeading } from "../../app/core/heading";
import { useLocation } from "../../app/core/location";
import { destination } from "../../shared/geo";
import { MAP_INK, useGeoJsonLayer } from "./layer-kit";

/** Your position: a pulsing marker, a cone toward where you face when the compass knows, and a disc showing how precise the fix is. */
export function YouLayer({ map }: { map: MapLibreMap }): ReactElement | null {
  const here = useLocation((s) => s.here);
  const marker = useRef<Marker | null>(null);
  const cone = useRef<Marker | null>(null);
  // A pinned or internet-address position is not where the device is, so its compass says nothing about it.
  const heading = useHeading(here?.source === "gps");

  useEffect(() => {
    const el = document.createElement("div");
    el.className = "city-you";
    el.innerHTML = '<span class="city-you__ring"></span><span class="city-you__ring city-you__ring--late"></span><span class="city-you__dot"></span>';
    // Unrounded, like the map itself: a rounded marker snaps by up to half a pixel each time the camera stops.
    marker.current = new Marker({ element: el, subpixelPositioning: true });
    // The cone lies on the map and turns with it, so its rotation is your compass heading, whatever the map's bearing.
    const coneEl = document.createElement("div");
    coneEl.className = "city-cone";
    coneEl.innerHTML = '<span class="city-cone__beam"></span>';
    cone.current = new Marker({ element: coneEl, rotationAlignment: "map", pitchAlignment: "map", subpixelPositioning: true });
    return () => {
      marker.current?.remove();
      cone.current?.remove();
      marker.current = null;
      cone.current = null;
    };
  }, [map]);

  useEffect(() => {
    if (!here || !marker.current) return;
    marker.current.setLngLat([here.lon, here.lat]).addTo(map);
    marker.current.getElement().dataset.source = here.source;
  }, [map, here]);

  // The beam eases to each new heading with a CSS transition: nothing runs while the heading holds still.
  const turned = useRef<number | null>(null);
  useEffect(() => {
    const c = cone.current;
    if (!c) return;
    if (!here || heading === null) {
      c.remove();
      turned.current = null;
      return;
    }
    c.setLngLat([here.lon, here.lat]);
    if (!c.getElement().isConnected) c.addTo(map);
    turned.current = unwrapDeg(turned.current, heading);
    const beam = c.getElement().firstElementChild;
    if (beam instanceof HTMLElement) beam.style.rotate = `${turned.current.toFixed(1)}deg`;
  }, [map, here, heading]);

  const accuracy = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!here) return null;
    // IP positions are only city-accurate: draw a wide, faint 5 km disc rather than pretend.
    const radius = here.accuracyM ?? (here.source === "ip" ? 5000 : null);
    if (!radius) return null;
    const ring = Array.from({ length: 65 }, (_, i) => {
      const p = destination(here, (i / 64) * 360, radius);
      return [p.lon, p.lat];
    });
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } }] };
  }, [here]);

  useGeoJsonLayer(map, {
    id: "city-you-accuracy",
    data: accuracy,
    belowLabels: true,
    layers: (source) => [
      { id: `${source}-fill`, type: "fill", source, paint: { "fill-color": MAP_INK.ice, "fill-opacity": 0.06 } },
      { id: `${source}-edge`, type: "line", source, paint: { "line-color": MAP_INK.ice, "line-opacity": 0.35, "line-width": 1, "line-dasharray": [2, 3] } },
    ],
  });

  return null;
}
