import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { useJamming } from "./client";
import "./gnss.css";

const dateWords = (date: string): string => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/**
 * GPS interference from gpsjam.org: hexagons coloured by the share of aircraft that reported poor navigation
 * accuracy during the last full UTC day. Reports come from aircraft, so there is nothing where nobody flew.
 */
export default function JamLayer({ map, report }: MapLayerProps): ReactElement | null {
  const { data, error, loading } = useJamming();
  const [picked, setPicked] = useState<{ share: number; bad: number; total: number } | null>(null);

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data ? data.cells.features.length : null }), [report, data, error, loading]);

  useGeoJsonLayer(map, {
    id: "gnss-jam",
    data: data?.cells ?? null,
    belowLabels: true,
    clickable: ["gnss-jam-fill"],
    onClick: (feature) => {
      const p = feature.properties;
      setPicked({ share: Number(p.share), bad: Number(p.badAircraft), total: Number(p.badAircraft) + Number(p.goodAircraft) });
    },
    layers: (source) => [
      {
        id: `${source}-fill`,
        type: "fill",
        source,
        paint: { "fill-color": ["match", ["get", "level"], "heavy", MAP_INK.alarm, MAP_INK.sodium], "fill-opacity": ["match", ["get", "level"], "heavy", 0.5, 0.26] },
      },
      {
        id: `${source}-edge`,
        type: "line",
        source,
        paint: { "line-color": ["match", ["get", "level"], "heavy", MAP_INK.alarm, MAP_INK.sodium], "line-opacity": 0.55, "line-width": 0.6 },
      },
    ],
  });

  if (!data) return null;
  return createPortal(
    <div className="gnss-legend" role="note">
      <div className="gnss-legend__date">
        GPS interference · {dateWords(data.date)} (UTC){data.suspect ? " · incomplete data" : ""}
      </div>
      {picked ? (
        <div className="gnss-legend__pick num">
          {picked.share} % in the cell you picked: {picked.bad} of {picked.total} aircraft reported poor accuracy.
        </div>
      ) : (
        <div className="gnss-legend__pick">Pick a hexagon to see how many aircraft reported poor accuracy.</div>
      )}
      <div className="gnss-legend__keys">
        <span>
          <i className="gnss-legend__swatch gnss-legend__swatch--some" />2 to 10 % of aircraft
        </span>
        <span>
          <i className="gnss-legend__swatch gnss-legend__swatch--heavy" />
          over 10 %
        </span>
      </div>
    </div>,
    map.getContainer(),
  );
}
