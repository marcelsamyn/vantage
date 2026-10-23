import { Video } from "lucide-react";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import { fetchRemote } from "./client";
import { useCameraDirections } from "./CameraDirections";
import { useMapCentre } from "./store";

import type { Webcam } from "./types";

const NO_CAMERAS: readonly Webcam[] = [];

/** Cameras in places few people go: volcanoes, ocean buoys, polar stations and observatories. */
export default function RemoteLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll(fetchRemote, 600_000, []);
  const selected = useProfile((s) => (s.entity?.kind === "webcam" ? s.entity.id : null));
  const icon = useMapIcon(map, "webcams-video", Video);
  const view = useMapView(map);
  useCameraDirections(map, data?.cameras ?? NO_CAMERAS, "webcams-remote-directions");
  const setCentre = useMapCentre((s) => s.set);
  useEffect(() => {
    setCentre(view.center);
  }, [setCentre, view.center]);
  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? (data?.failed.length ? `Unavailable: ${data.failed.join(", ")}` : null), count: data?.cameras.length ?? null });
  }, [report, data, error, loading]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data && icon
        ? { type: "FeatureCollection", features: data.cameras.map((c) => ({ type: "Feature", properties: { id: c.id, selected: c.id === selected }, geometry: { type: "Point", coordinates: [c.lon, c.lat] } })) }
        : null,
    [data, icon, selected],
  );

  useGeoJsonLayer(map, {
    id: "webcams-remote",
    data: points,
    fadeBy: "id",
    clickable: ["webcams-remote-dot"],
    onClick: (f) => {
      const c = data?.cameras.find((x) => x.id === f.properties.id);
      if (c) profile.open({ kind: "webcam", id: c.id, data: c });
    },
    layers: (source) => [
      {
        id: `${source}-dot`,
        type: "circle",
        source,
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 4, 6, 6.5, 12, 10],
          "circle-color": MAP_INK.void,
          "circle-stroke-color": MAP_INK.sodium,
          "circle-stroke-width": ["case", ["get", "selected"], 3, 1.6],
        },
      },
      { id: `${source}-core`, type: "circle", source, maxzoom: 6, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.4, 6, 2.2], "circle-color": MAP_INK.sodium } },
      ringIcon(source, { icon: "webcams-video", color: MAP_INK.sodium, minzoom: 6, px: [[6, 8.5], [12, 13]] }),
    ],
  });
  return null;
}
