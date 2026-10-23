import { useEffect, useMemo } from "react";
import { fmt } from "../../app/core/format";
import { profile, useProfile } from "../../app/core/profile";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { useParking } from "./client";
import { PARK_BADGES, parkIcon, useBadges } from "./icons";
import { parkOccupied, parkTone } from "./words";

/** Car parks with the free spaces their operators report. The ring around each shows how full it is. */
export default function ParkingLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = useParking();
  const ready = useBadges(map, PARK_BADGES);
  const selected = useProfile((s) => (s.entity?.kind === "carpark" ? s.entity.id : null));
  const parks = useMemo(() => data?.parks ?? [], [data]);
  const byId = useMemo(() => new Map(parks.map((p) => [p.id, p])), [parks]);

  const points = useMemo(
    (): GeoJSON.FeatureCollection | null =>
      ready
        ? {
            type: "FeatureCollection",
            features: parks.map((p) => ({
              type: "Feature",
              properties: { id: p.id, icon: parkIcon(parkTone(p), parkOccupied(p)), label: p.open && p.free !== null ? fmt.int(p.free) : p.open ? "" : "closed", sel: p.id === selected },
              geometry: { type: "Point", coordinates: [p.lon, p.lat] },
            })),
          }
        : null,
    [ready, parks, selected],
  );

  useGeoJsonLayer(map, {
    id: "pulse-parking",
    data: points,
    fadeBy: "id",
    clickable: ["pulse-parking-badge"],
    onClick: (f) => {
      const park = byId.get(String(f.properties.id));
      if (park) profile.open({ kind: "carpark", id: park.id, data: { park } });
    },
    layers: (source) => [
      { id: `${source}-sel`, type: "circle", source, filter: ["get", "sel"], paint: { "circle-radius": 21, "circle-color": MAP_INK.ice, "circle-opacity": 0.12, "circle-stroke-color": MAP_INK.ice, "circle-stroke-width": 1 } },
      {
        id: `${source}-badge`,
        type: "symbol",
        source,
        layout: { "icon-image": ["get", "icon"], "icon-size": ["interpolate", ["linear"], ["zoom"], 10, 0.6, 14, 0.85, 17, 1.05], "icon-allow-overlap": true, "icon-ignore-placement": true },
      },
      {
        id: `${source}-label`,
        type: "symbol",
        source,
        minzoom: 12.5,
        layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.6], "text-anchor": "top", "text-letter-spacing": 0.04, "text-optional": true },
        paint: { "text-color": MAP_INK.bone, "text-halo-color": MAP_INK.void, "text-halo-width": 1.3 },
      },
    ],
  });

  useEffect(() => {
    const partial = data && data.errors.length > 0 ? `Some cities did not answer: ${data.errors.join("; ")}` : null;
    report({ loading: loading && !data, error: error?.message ?? partial, count: parks.length });
  }, [report, loading, data, error, parks.length]);
  return null;
}
