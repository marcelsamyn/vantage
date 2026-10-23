import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useDomMarkers, useGeoJsonLayer, type DomMarker } from "../city/extension";
import type { Post } from "./types";

/** From this zoom, posts with a photo show the photo itself in a round frame. */
export const PHOTO_ZOOM = 14;
const DROP_MS = 900;
const NONE: ReadonlySet<string> = new Set();

/** One post as the map draws it. */
export interface Mark {
  post: Post;
  ink: string;
  /** Drawn as a ring instead of a solid dot. */
  hollow: boolean;
  /** 1 for the newest, lower as the post ages. */
  fade: number;
}

export const openPost = (post: Post): void => profile.open({ kind: "post", id: post.id, data: post });

const useSelectedPost = (): string | null => useProfile((s) => (s.entity?.kind === "post" ? s.entity.id : null));

function points(marks: readonly Mark[], selected: string | null): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: marks.map((m) => ({
      type: "Feature",
      properties: { id: m.post.id, ink: m.ink, hollow: m.hollow, fade: m.fade, selected: m.post.id === selected },
      geometry: { type: "Point", coordinates: [m.post.lon, m.post.lat] },
    })),
  };
}

/**
 * Draw posts as dots, and from PHOTO_ZOOM as round photos. A post that arrived while you watched drops in once:
 * a ring closes onto its dot, or its photo falls into place. That motion follows data, so it always runs once, and
 * no frame loop runs otherwise.
 */
export function usePostMarks(map: MapLibreMap, id: string, marks: readonly Mark[], arrivals: ReadonlySet<string>, zoom: number): void {
  const selected = useSelectedPost();
  const photos = zoom >= PHOTO_ZOOM;
  const pinned = useMemo(() => (photos ? marks.filter((m) => m.post.photo) : []), [marks, photos]);
  const dots = useMemo(() => (photos ? marks.filter((m) => !m.post.photo) : marks), [marks, photos]);
  const byId = useMemo(() => new Map(marks.map((m) => [m.post.id, m.post])), [marks]);
  const dotData = useMemo(() => points(dots, selected), [dots, selected]);

  useGeoJsonLayer(map, {
    id,
    data: dotData,
    fadeBy: "id",
    clickable: [`${id}-dot`],
    onClick: (f) => {
      const post = byId.get(String(f.properties.id));
      if (post) openPost(post);
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, ["case", ["get", "selected"], 6, 3.2], 13, ["case", ["get", "selected"], 8, 5], 17, ["case", ["get", "selected"], 10, 7]],
          "circle-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "hollow"], MAP_INK.void, ["get", "ink"]],
          "circle-opacity": ["case", ["get", "hollow"], ["*", 0.55, ["get", "fade"]], ["get", "fade"]],
          "circle-stroke-color": ["case", ["get", "selected"], MAP_INK.ice, ["get", "hollow"], ["get", "ink"], MAP_INK.void],
          "circle-stroke-width": ["case", ["get", "hollow"], 1.6, 0.8],
          "circle-stroke-opacity": ["case", ["get", "hollow"], ["get", "fade"], 0.7],
        },
      },
    ],
  });

  useDropRings(map, `${id}-drop`, dots, arrivals);
  usePins(map, pinned, arrivals, selected);
}

/**
 * A ring that closes onto each new dot, for a little under a second. It plays when a new set of arrivals comes in,
 * and not again when a zoom change rebuilds the dots.
 */
function useDropRings(map: MapLibreMap, id: string, dots: readonly Mark[], arrivals: ReadonlySet<string>): void {
  const reducedMotion = usePrefersReducedMotion();
  const dotsRef = useRef(dots);
  dotsRef.current = dots;
  const [rings, setRings] = useState<GeoJSON.FeatureCollection | null>(null);
  useGeoJsonLayer(map, {
    id,
    data: rings,
    layers: (source) => [
      {
        id: `${source}-ring`,
        type: "circle",
        source,
        paint: { "circle-radius": 4, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "ink"], "circle-stroke-width": 1.5, "circle-stroke-opacity": 0 },
      },
    ],
  });
  useEffect(() => {
    const fresh = dotsRef.current.filter((m) => arrivals.has(m.post.id));
    if (!fresh.length || reducedMotion) return;
    setRings(points(fresh, null));
    const layer = `${id}-ring`;
    const start = performance.now();
    let frame = 0;
    // A map paint property, not CSS: the ring lives in the map canvas. The loop ends with the animation.
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / DROP_MS);
      const eased = 1 - (1 - t) ** 3;
      if (map.getLayer(layer)) {
        map.setPaintProperty(layer, "circle-radius", 22 - 17 * eased);
        map.setPaintProperty(layer, "circle-stroke-opacity", t < 0.15 ? (t / 0.15) * 0.9 : 0.9 * (1 - (t - 0.15) / 0.85));
      }
      if (t < 1) frame = requestAnimationFrame(tick);
      else setRings(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [map, id, arrivals, reducedMotion]);
}

/** A post with a photo, as a round frame on the map. */
interface Pin {
  post: Post;
  thumb: string;
  ink: string;
  fade: number;
  selected: boolean;
  /** It arrived in the latest refresh, so it drops in when first drawn. */
  fresh: boolean;
}

function buildPin(pin: Pin): DomMarker<Pin> {
  const element = document.createElement("div");
  element.className = "posts-pin";
  const body = document.createElement("button");
  body.type = "button";
  body.className = pin.fresh ? "posts-pin__body posts-pin__body--new" : "posts-pin__body";
  body.addEventListener("animationend", () => body.classList.remove("posts-pin__body--new"), { once: true });
  const img = document.createElement("img");
  img.src = pin.thumb;
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  body.append(img);
  element.append(body);
  return {
    element,
    update: ({ post, ink, fade, selected }) => {
      body.style.setProperty("--posts-ring", selected ? MAP_INK.ice : ink);
      body.style.setProperty("--posts-fade", String(fade));
      body.classList.toggle("posts-pin__body--selected", selected);
      body.setAttribute("aria-label", `${post.title}, open its profile`);
      body.title = post.title;
    },
  };
}

/** Round photo frames as DOM markers, so each photo loads straight from its source and stays crisp. */
function usePins(map: MapLibreMap, marks: readonly Mark[], arrivals: ReadonlySet<string>, selected: string | null): void {
  const drawnArrivals = useRef(arrivals);
  useEffect(() => {
    drawnArrivals.current = arrivals;
  }, [arrivals]);
  const pins = useMemo((): Pin[] => {
    // Only a new set of arrivals drops in; a pin rebuilt by a zoom change appears without motion.
    const fresh = arrivals === drawnArrivals.current ? NONE : arrivals;
    return marks.flatMap((m) => (m.post.photo ? [{ post: m.post, thumb: m.post.photo.thumb, ink: m.ink, fade: m.fade, selected: m.post.id === selected, fresh: fresh.has(m.post.id) }] : []));
  }, [marks, arrivals, selected]);
  useDomMarkers(map, pins, { id: (pin) => pin.post.id, at: (pin) => pin.post, build: buildPin, onClick: (pin) => openPost(pin.post) });
}
