import { Video } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useMemo } from "react";
import { useNow } from "../../app/core/hooks";
import { distanceM } from "../../shared/geo";
import { MAP_INK, ringIcon, useDomMarkers, useGeoJsonLayer, useMapIcon, useMapView, type DomMarker } from "../city/extension";
import { freshUrl } from "./client";
import { useCameraDirections } from "./CameraDirections";
import type { Webcam } from "./types";
import "./webcams.css";

/** From this zoom, the cameras nearest the centre show their latest picture instead of a dot. */
const PREVIEW_ZOOM = 15;
/** Pictures load straight from each operator; this many keeps a busy city centre light and readable. */
const MAX_PREVIEWS = 48;
/** Pictures are due again on each camera's own period, checked once a minute. */
const PICTURE_CLOCK_MS = 60_000;

interface Preview {
  camera: Webcam;
  /** The picture address, changed once per operator period so the browser asks for the new frame. */
  src: string;
  selected: boolean;
}

/** One empty list, so the dots are not rebuilt while no camera shows its picture. */
const NO_PREVIEWS: readonly Preview[] = [];

function buildPreview(): DomMarker<Preview> {
  const element = document.createElement("div");
  element.className = "webcams-pin";
  const body = document.createElement("button");
  body.type = "button";
  body.className = "webcams-pin__body";
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "lazy";
  img.decoding = "async";
  img.draggable = false;
  img.referrerPolicy = "no-referrer";
  // A camera whose operator does not answer keeps an empty frame, not the browser's broken-picture icon.
  img.addEventListener("error", () => body.classList.add("webcams-pin__body--blank"));
  img.addEventListener("load", () => body.classList.remove("webcams-pin__body--blank"));
  const rec = document.createElement("i");
  rec.className = "webcams-pin__rec";
  body.append(img, rec);
  element.append(body);
  return {
    element,
    update: ({ camera, src, selected }) => {
      if (img.getAttribute("src") !== src) img.src = src;
      rec.hidden = camera.stream === null;
      body.classList.toggle("webcams-pin__body--selected", selected);
      body.setAttribute("aria-label", `${camera.name}, ${camera.stream ? "live video" : "latest picture"}. Open the camera`);
      body.title = camera.name;
    },
  };
}

/** Shared camera markers and previews for the map and Around Me. */
export function CameraMarks({ map, cameras, selected, choose }: { map: MapLibreMap; cameras: readonly Webcam[]; selected: string | null; choose: (camera: Webcam) => void }): null {
  const view = useMapView(map);
  const icon = useMapIcon(map, "webcams-video", Video);
  useCameraDirections(map, cameras);
  const previewing = view.zoom >= PREVIEW_ZOOM;
  const now = useNow(previewing ? PICTURE_CLOCK_MS : null);
  const previews = useMemo((): readonly Preview[] => {
    if (!previewing) return NO_PREVIEWS;
    return cameras
      .map((camera) => ({ camera, d: distanceM(view.center, camera) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX_PREVIEWS)
      .map(({ camera }) => ({ camera, src: freshUrl(camera.image, Math.floor(now / Math.max(PICTURE_CLOCK_MS, camera.refreshS * 1000))), selected: camera.id === selected }));
  }, [cameras, previewing, view.center, now, selected]);
  useDomMarkers(map, previews, { id: (p) => p.camera.id, at: (p) => p.camera, build: buildPreview, onClick: (p) => choose(p.camera) });

  const points = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!icon) return null;
    const pictured = new Set(previews.map((p) => p.camera.id));
    return {
      type: "FeatureCollection",
      features: cameras
        .filter((c) => !pictured.has(c.id))
        .map((c) => ({ type: "Feature", properties: { id: c.id, selected: c.id === selected }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })),
    };
  }, [cameras, icon, previews, selected]);

  useGeoJsonLayer(map, {
    id: "webcams-cams",
    data: points,
    fadeBy: "id",
    clickable: ["webcams-cams-dot"],
    onClick: (f) => {
      const c = cameras.find((x) => x.id === f.properties.id);
      if (c) choose(c);
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3, 13, 6.5, 16, 10, 19, 12],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": MAP_INK.ice,
          "circle-stroke-width": ["case", ["get", "selected"], 3, 1.6],
        },
      },
      { id: `${source}-core`, type: "circle", source, maxzoom: 12, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.2, 12, 2.2], "circle-color": MAP_INK.ice } },
      ringIcon(source, { icon: "webcams-video", color: MAP_INK.ice, minzoom: 12, px: [[12, 8], [16, 13], [19, 16]] }),
    ],
  });
  return null;
}
