import { Pause, Play } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useAmbientMotion, useNow, usePoll, usePrefersReducedMotion } from "../../app/core/hooks";
import { IconButton } from "../../app/ui";
import { addMapLayers, type MapLayerProps } from "../city/extension";
import { behindWords, fetchLightningFrames, lightningImageUrl } from "./client";
import { Legend } from "./Legends";
import "./weather.css";

const STEP_MS = 420;
const HOLD_MS = 1800;
const OPACITY = 0.92;

const layerId = (frameTime: string): string => `weather-lightning-${frameTime}`;

function removeFrame(map: MapLibreMap, frameTime: string): void {
  const id = layerId(frameTime);
  if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(id)) map.removeSource(id);
}

/**
 * Lightning over Europe from Meteosat's Lightning Imager, as a loop of the last hour in 5-minute steps.
 * Every frame is its own raster layer and only opacity changes, so the loop never re-downloads a picture.
 */
export default function LightningLayer({ map, report }: MapLayerProps): ReactElement | null {
  const { data, error, loading } = usePoll((signal) => fetchLightningFrames(signal), 2 * 60_000, []);
  // The loop is ambient: at rest it holds on the latest frame.
  const looping = useAmbientMotion();
  const reduced = usePrefersReducedMotion();
  const now = useNow(30_000);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  const frames = data?.frames ?? [];
  const key = frames.join(",");
  const last = frames.length - 1;

  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: null }), [report, data, error, loading]);

  // The frame time names a picture. Each poll adds the frames that are new and removes the ones that left the hour, so the
  // pictures already on the map stay put and are not downloaded again.
  const onMap = useRef(new Set<string>());
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!data || frames.length === 0) return;
    const { west, south, east, north } = data.bounds;
    for (const t of frames) {
      if (onMap.current.has(t)) continue;
      const id = layerId(t);
      map.addSource(id, {
        type: "image",
        url: lightningImageUrl(t),
        coordinates: [
          [west, north],
          [east, north],
          [east, south],
          [west, south],
        ],
      });
      addMapLayers(map, [{ id, type: "raster", source: id, paint: { "raster-opacity": 0, "raster-opacity-transition": { duration: 200 }, "raster-fade-duration": 0 } }], true);
      onMap.current.add(t);
    }
    for (const t of onMap.current) {
      if (frames.includes(t)) continue;
      removeFrame(map, t);
      onMap.current.delete(t);
    }
    // Stay on the frame being shown; if it has just left the hour, or nothing was shown yet, jump to the newest.
    const kept = shown.current ? frames.indexOf(shown.current) : -1;
    setFrame(kept >= 0 ? kept : last);
    // The frame times are the identity of the pictures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);

  useEffect(
    () => () => {
      if (map.style) for (const t of onMap.current) removeFrame(map, t);
      onMap.current.clear();
      shown.current = null;
    },
    [map],
  );

  useEffect(() => {
    if (!looping && playing) {
      setFrame(Math.max(0, last));
      return;
    }
    if (!playing || frames.length < 2) return;
    const t = setTimeout(() => setFrame((f) => (f >= last ? 0 : f + 1)), frame === last ? HOLD_MS : STEP_MS);
    return () => clearTimeout(t);
  }, [looping, playing, frame, last, frames.length]);

  useEffect(() => {
    shown.current = frames[frame] ?? null;
    frames.forEach((t, i) => {
      const id = layerId(t);
      if (map.getLayer(id)) map.setPaintProperty(id, "raster-opacity", i === frame ? OPACITY : 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, frame, key]);

  if (!data) return null;
  const newest = frames[last] ?? "";
  const shownTime = frames[frame] ?? newest;
  return (
    <Legend>
      <div className="weather-legend weather-sat" role="group" aria-label="Lightning, last hour">
        <div className="weather-sat__head">
          <span className="v-eyebrow">Lightning · last hour</span>
          <span className="weather-sat__delay num">
            Newest frame {fmt.clock(Date.parse(newest))}, {behindWords(newest, now)}
          </span>
        </div>
        <div className="weather-sat__scrub">
          <IconButton label={playing ? "Pause the loop" : "Play the loop"} on={playing} onClick={() => setPlaying((p) => !p)}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <div className="weather-sat__ticks">
            {frames.map((t, i) => (
              <button
                key={t}
                type="button"
                className="weather-sat__tick"
                aria-label={`Frame from ${fmt.clock(Date.parse(t))}`}
                aria-pressed={i === frame}
                onClick={() => {
                  setPlaying(false);
                  setFrame(i);
                }}
              />
            ))}
          </div>
          <span className="weather-sat__clock num">{fmt.clock(Date.parse(shownTime))}</span>
        </div>
        <div className="weather-sat__scale">
          <span className="num">1</span>
          <i className="weather-sat__ramp" />
          <span className="num">20+</span>
          <span className="weather-sat__unit">flashes per 5 minutes</span>
        </div>
        <div className="weather-legend__note">Each frame counts the flashes the satellite saw in one 5-minute step. A status picture, not a safety service. Contains modified EUMETSAT Meteosat data {new Date(newest).getUTCFullYear()}.</div>
      </div>
    </Legend>
  );
}
