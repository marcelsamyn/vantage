import { Signpost, TrainFront, TrainFrontTunnel } from "lucide-react";
import type { Map as MapLibreMap, SymbolLayerSpecification } from "maplibre-gl";
import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, ringIcon, useGeoJsonLayer, useMapIcon, useMapView, type MapLayerProps } from "../city/extension";
import type { TransitStop } from "./types";
import { fetchStops, modeGroup } from "./client";

/** Transit stops in view. Click one for its live departures board. */
export default function StopLayer({ map, report }: MapLayerProps): null {
  const view = useMapView(map);
  const key = `${view.west.toFixed(3)},${view.south.toFixed(3)},${view.east.toFixed(3)},${view.north.toFixed(3)}`;
  const { data, error, loading } = usePoll((signal) => fetchStops(view, signal), null, [key]);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.length ?? null }), [report, data, error, loading]);
  useStopMarkers(map, "transit-stops", data ?? null);
  return null;
}

const stopFrame = (color: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="1" fill="${MAP_INK.void}" stroke="${color}" stroke-width="1.5"/></svg>`;
const STOP_FRAME = stopFrame(MAP_INK.bone);
const STATION_FRAME = stopFrame(MAP_INK.ice);

/** Square signs distinguish stationary stops and stations from round vehicle markers. */
function useStopMarkers(map: MapLibreMap, id: string, data: readonly TransitStop[] | null): void {
  const selected = useProfile((s) => (s.entity?.kind === "stop" ? s.entity.id : null));
  const ready = [
    useMapIcon(map, "transit-stop-frame", STOP_FRAME, { sdf: false }),
    useMapIcon(map, "transit-station-frame", STATION_FRAME, { sdf: false }),
    useMapIcon(map, "transit-stop-sign", Signpost),
    useMapIcon(map, "transit-stop-metro", TrainFrontTunnel),
    useMapIcon(map, "transit-stop-rail", TrainFront),
  ].every(Boolean);
  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      data
        ? { type: "FeatureCollection", features: data.map((s): GeoJSON.Feature => {
          const groups = s.modes.map(modeGroup);
          const kind = groups.includes("rail") ? "rail" : groups.includes("metro") ? "metro" : "sign";
          return { type: "Feature", properties: { id: s.stopId, name: s.name, selected: s.stopId === selected, station: kind !== "sign", icon: `transit-stop-${kind}` }, geometry: { type: "Point", coordinates: [s.lon, s.lat] } };
        }) }
        : null,
    [data, selected],
  );

  useGeoJsonLayer(map, {
    id,
    data: ready ? points : null,
    fadeBy: "id",
    clickable: [`${id}-frame`],
    onClick: (f) => {
      const s = data?.find((x) => x.stopId === f.properties.id);
      if (s) profile.open({ kind: "stop", id: s.stopId, data: s });
    },
    layers: (source) => [
      {
        id: `${source}-frame`,
        type: "symbol",
        source,
        minzoom: 13.5,
        filter: ["any", ["get", "station"], ["get", "selected"], [">=", ["zoom"], 15]],
        layout: {
          "icon-image": ["case", ["any", ["get", "selected"], ["get", "station"]], "transit-station-frame", "transit-stop-frame"],
          "icon-size": ["interpolate", ["linear"], ["zoom"], 13.5, ["case", ["get", "selected"], 1, ["get", "station"], 0.9, 0.75], 18, ["case", ["get", "selected"], 1.2, ["get", "station"], 1.1, 0.95]],
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
      },
      {
        ...ringIcon(source, { icon: ["get", "icon"], color: ["case", ["any", ["get", "selected"], ["get", "station"]], MAP_INK.ice, MAP_INK.bone], px: [[13.5, 12], [18, 16]], minzoom: 13.5 }),
        filter: ["any", ["get", "station"], ["get", "selected"], [">=", ["zoom"], 15]],
      },
      ...[true, false].map((station): SymbolLayerSpecification => ({
        id: `${source}-${station ? "station-name" : "name"}`,
        type: "symbol",
        source,
        minzoom: station ? 14.5 : 16,
        filter: ["==", ["get", "station"], station],
        layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": station ? 12 : 11, "text-offset": [0, 1.35], "text-anchor": "top", "text-optional": true, "symbol-sort-key": ["case", ["get", "selected"], -1, station ? 0 : 1] },
        paint: { "text-color": station ? MAP_INK.ice : MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.5 },
      })),
    ],
  });
}
