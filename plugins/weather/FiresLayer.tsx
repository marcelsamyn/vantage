import { useEffect, useMemo, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { MAP_INK, useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { behindWords, fetchFires } from "./client";
import { Legend } from "./Legends";
import "./weather.css";

/** Fires and other very hot spots that Meteosat sees from 36,000 km up, as glowing points. */
export default function FiresLayer({ map, report }: MapLayerProps): ReactElement | null {
  const { data, error, loading } = usePoll((signal) => fetchFires(signal), 10 * 60_000, []);
  const now = useNow(60_000);

  const collection = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!data) return null;
    return { type: "FeatureCollection", features: data.spots.map((s) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [s.lon, s.lat] } })) };
  }, [data]);

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data ? data.spots.length : null }), [report, data, error, loading]);

  useGeoJsonLayer(map, {
    id: "weather-fires",
    data: collection,
    layers: (source) => [
      { id: `${source}-halo`, type: "circle", source, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 9, 10, 26], "circle-color": MAP_INK.alarm, "circle-opacity": 0.22, "circle-blur": 0.8 } },
      { id: `${source}-core`, type: "circle", source, paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, 3.5, 10, 7], "circle-color": MAP_INK.alarm, "circle-stroke-color": MAP_INK.bone, "circle-stroke-width": 1 } },
    ],
  });

  if (!data) return null;
  return (
    <Legend>
      <div className="weather-legend weather-sat" role="group" aria-label="Satellite fire detections">
        <div className="weather-sat__head">
          <span className="v-eyebrow">Fires seen from space</span>
          <span className="weather-sat__delay num">
            {data.spots.length === 0 ? "None right now" : `${data.spots.length} ${data.spots.length === 1 ? "hot spot" : "hot spots"}`} · frame {fmt.clock(Date.parse(data.time))}, {behindWords(data.time, now)}
          </span>
        </div>
        <div className="weather-legend__note">
          Meteosat covers 12°W to 40°E and 30°N to 62°N. A hot spot can be a wildfire, a gas flare or a volcano. A status picture, not a warning. Contains modified EUMETSAT Meteosat data {new Date(data.time).getUTCFullYear()}.
        </div>
      </div>
    </Legend>
  );
}
