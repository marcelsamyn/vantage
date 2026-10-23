import { useEffect, useState } from "react";
import { useAmbientMotion, usePoll } from "../../app/core/hooks";
import { addMapLayers, type MapLayerProps } from "../city/extension";
import { fetchRadar } from "./client";

const FRAMES = 8;
const STEP_MS = 550;
const HOLD_MS = 1600;
const OPACITY = 0.62;

/**
 * Rain radar from RainViewer: the last frames loop so you can see which way the rain is moving.
 * Each frame is its own raster layer; only opacity changes, so the loop never re-downloads tiles.
 */
export default function RadarLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll((signal) => fetchRadar(signal), 5 * 60_000, []);
  // The loop is ambient: at rest it holds on the latest frame, so a glance shows the rain now, not an hour ago.
  const looping = useAmbientMotion();
  const [frame, setFrame] = useState(0);
  const frames = data ? data.frames.slice(-FRAMES) : [];
  const key = frames.map((f) => f.path).join(",");

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: null }), [report, data, error, loading]);

  useEffect(() => {
    if (!data || frames.length === 0) return;
    const ids = frames.map((_, i) => `weather-radar-${i}`);
    frames.forEach((f, i) => {
      map.addSource(ids[i] ?? "", { type: "raster", tiles: [`${data.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png`], tileSize: 256, maxzoom: 7, attribution: "RainViewer" });
      addMapLayers(map, [{ id: ids[i] ?? "", type: "raster", source: ids[i] ?? "", paint: { "raster-opacity": i === frames.length - 1 ? OPACITY : 0, "raster-opacity-transition": { duration: 350 }, "raster-fade-duration": 0 } }], true);
    });
    setFrame(frames.length - 1);
    return () => {
      if (!map.style) return;
      for (const id of ids) {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  // Loop through the frames, pausing on the latest one.
  useEffect(() => {
    const last = frames.length - 1;
    if (!looping) {
      setFrame(Math.max(0, last));
      return;
    }
    if (frames.length < 2) return;
    const t = setTimeout(() => setFrame((f) => (f >= last ? 0 : f + 1)), frame === last ? HOLD_MS : STEP_MS);
    return () => clearTimeout(t);
  }, [looping, frame, frames.length]);

  useEffect(() => {
    frames.forEach((_, i) => {
      const id = `weather-radar-${i}`;
      if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", i === frame ? OPACITY : 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, frame, key]);

  return null;
}
