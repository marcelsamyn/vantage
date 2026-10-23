import { Globe, LocateFixed } from "lucide-react";
import { Map as MapLibre, Marker, setWorkerUrl, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useAnimationFrame, useNow, usePrefersReducedMotion } from "../../app/core/hooks";
import type { Here } from "../../app/core/location";
import { Button, Empty, IconButton, Scanning } from "../../app/ui";
import { MAP_INK, useGeoJsonLayer } from "../city/extension";
import { currentLevel, usePlayer } from "./audio";
import { nightPolygon } from "./sun";
import type { Microphone } from "./types";
import { loadWorldStyle } from "./world-style";

// Served by the City plugin's api.ts `assets` entry, the same worker the City map uses.
setWorkerUrl("/assets/city/maplibre/maplibre-gl-worker.mjs");

const WORLD_CENTRE: [number, number] = [10, 28];

/**
 * Microphones breathe in a few groups, out of step with their neighbours. Every loop that ends an iteration
 * wakes the main thread, so a few shared phases cost a fraction of one phase per microphone and still look loose.
 */
const PHASES = 6;

/** A stable phase group from an id. */
function phaseOf(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 9973;
  return Math.floor((h / 9973) * PHASES) / PHASES;
}

function markerFor(mic: Microphone, choose: (mic: Microphone) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `listen-mic${mic.format === "hls" ? " listen-mic--hydro" : ""}${mic.live ? "" : " listen-mic--offline"}`;
  el.dataset.label = `${mic.place} · ${mic.name}`;
  el.setAttribute("aria-label", `${mic.name}, ${mic.place}${mic.live ? "" : ", offline"}`);
  el.style.setProperty("--phase", String(phaseOf(mic.id)));
  el.innerHTML = '<span class="listen-mic__ring"></span><span class="listen-mic__ring listen-mic__ring--late"></span><span class="listen-mic__core"></span>';
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    choose(mic);
  });
  return el;
}

interface Props {
  mics: readonly Microphone[];
  here: Here | null;
  selectedId: string | null;
  onChoose: (mic: Microphone) => void;
}

/** The hero: a dark world plane where every open microphone glows and breathes, with the night side shaded. */
export function ListeningMap({ mics, here, selectedId, onChoose }: Props): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const phase = usePlayer((s) => s.phase);
  const reduced = usePrefersReducedMotion();

  // The first fix usually arrives after the map exists. Until you move the map yourself, it follows you there once.
  const userMoved = useRef(false);
  const arrived = useRef(here !== null);
  useEffect(() => {
    let alive = true;
    let instance: MapLibreMap | null = null;
    let resizer: ResizeObserver | null = null;
    setError(null);
    loadWorldStyle()
      .then((style) => {
        if (!alive || !container.current) return;
        const start = here;
        instance = new MapLibre({
          container: container.current,
          style,
          center: start ? [start.lon, start.lat] : WORLD_CENTRE,
          zoom: start ? 3.2 : 1.3,
          minZoom: 0.8,
          maxZoom: 9,
          attributionControl: false,
          cooperativeGestures: true,
          fadeDuration: 150,
        });
        instance.dragRotate.disable();
        instance.touchZoomRotate.disableRotation();
        const m = instance;
        m.on("movestart", (e: { originalEvent?: unknown }) => {
          if (e.originalEvent) userMoved.current = true;
        });
        m.on("load", () => alive && setMap(m));
        // The grid row that holds the map changes height with the window, and MapLibre only watches window resizes.
        resizer = new ResizeObserver(() => m.resize());
        resizer.observe(container.current);
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
      setMap(null);
      resizer?.disconnect();
      instance?.remove();
    };
  }, [attempt]);

  useEffect(() => {
    if (!map || !here || arrived.current || userMoved.current) return;
    arrived.current = true;
    map.easeTo({ center: [here.lon, here.lat], zoom: 3.2, duration: reduced ? 0 : 1400 });
  }, [map, here, reduced]);

  // One marker per microphone. Their look follows the player state through classes, below.
  const choose = useRef(onChoose);
  choose.current = onChoose;
  const markers = useRef(new globalThis.Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (!map) return;
    const made: Marker[] = [];
    markers.current.clear();
    for (const mic of mics) {
      const el = markerFor(mic, (m) => choose.current(m));
      markers.current.set(mic.id, el);
      made.push(new Marker({ element: el, anchor: "center" }).setLngLat([mic.lon, mic.lat]).addTo(map));
    }
    return () => {
      for (const m of made) m.remove();
      markers.current.clear();
    };
  }, [map, mics]);

  useEffect(() => {
    for (const [id, el] of markers.current) {
      el.classList.toggle("listen-mic--selected", id === selectedId);
      el.classList.toggle("listen-mic--playing", id === selectedId && phase === "playing");
      el.classList.toggle("listen-mic--connecting", id === selectedId && phase === "connecting");
    }
  }, [selectedId, phase, map, mics]);

  // Bring the chosen microphone into view without changing the zoom more than needed. The list refreshes every five
  // minutes, so the effect reads it from a ref: only a new choice (or the choice's first appearance) moves the map.
  const micsRef = useRef(mics);
  micsRef.current = mics;
  const chosenListed = mics.some((m) => m.id === selectedId);
  useEffect(() => {
    const mic = micsRef.current.find((m) => m.id === selectedId);
    if (!map || !mic) return;
    map.easeTo({ center: [mic.lon, mic.lat], zoom: Math.max(map.getZoom(), 3.4), duration: reduced ? 0 : 900 });
  }, [map, selectedId, chosenListed, reduced]);

  // The chosen marker swells with the sound it carries: live data, so it follows the sound while it plays.
  useAnimationFrame(() => {
    container.current?.style.setProperty("--listen-level", currentLevel().toFixed(3));
  }, phase === "playing" && !reduced, "data");
  useEffect(() => {
    if (phase !== "playing") container.current?.style.setProperty("--listen-level", "0");
  }, [phase]);

  const live = mics.filter((m) => m.live).length;
  const hydrophones = mics.filter((m) => m.format === "hls").length;

  return (
    <div className="listen-map">
      <div ref={container} className="listen-map__canvas" />
      <div className="listen-map__vignette" aria-hidden />
      {error && (
        <div className="listen-map__centre">
          <Empty title="World map unavailable" tone="error" action={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
            {error} The list of microphones still works.
          </Empty>
        </div>
      )}
      {!map && !error && (
        <div className="listen-map__centre">
          <Scanning label="Tuning the world map" />
        </div>
      )}
      {map && (
        <>
          <NightLayer map={map} />
          <YouLayer map={map} here={here} />
          <div className="listen-map__hud">
            <div className="v-eyebrow">Live microphones</div>
            <div className="listen-map__count display num">{live}</div>
            <div className="listen-map__legend">
              <span>
                <i className="listen-key listen-key--mic" /> Microphone
              </span>
              {hydrophones > 0 && (
                <span>
                  <i className="listen-key listen-key--hydro" /> Underwater
                </span>
              )}
              <span>
                <i className="listen-key listen-key--night" /> Night side
              </span>
            </div>
          </div>
          <div className="listen-map__tools">
            <IconButton label="Show the whole world" onClick={() => map.easeTo({ center: WORLD_CENTRE, zoom: 1.3, duration: reduced ? 0 : 900 })}>
              <Globe size={15} />
            </IconButton>
            <IconButton label="Go to my location" disabled={!here} onClick={() => here && map.easeTo({ center: [here.lon, here.lat], zoom: 4.2, duration: reduced ? 0 : 900 })}>
              <LocateFixed size={15} />
            </IconButton>
          </div>
        </>
      )}
      <div className="listen-map__credit">Map © OpenFreeMap · OpenMapTiles · OpenStreetMap contributors</div>
    </div>
  );
}

/** The night side of the planet, shaded, and redrawn each minute as the terminator crawls west. */
function NightLayer({ map }: { map: MapLibreMap }): null {
  const minute = useNow(60_000);
  const data = useMemo<GeoJSON.FeatureCollection>(() => ({ type: "FeatureCollection", features: [nightPolygon(new Date(minute))] }), [minute]);
  useGeoJsonLayer(map, {
    id: "listen-night",
    data,
    layers: (source) => [{ id: `${source}-fill`, type: "fill", source, paint: { "fill-color": "#010305", "fill-opacity": 0.6 } }],
  });
  return null;
}

/** Where you are. Ice is the colour of you. */
function YouLayer({ map, here }: { map: MapLibreMap; here: Here | null }): null {
  const data = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: "FeatureCollection", features: here ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [here.lon, here.lat] } }] : [] }),
    [here],
  );
  useGeoJsonLayer(map, {
    id: "listen-you",
    data,
    layers: (source) => [
      { id: `${source}-halo`, type: "circle", source, paint: { "circle-radius": 11, "circle-color": MAP_INK.ice, "circle-opacity": 0.14, "circle-stroke-color": MAP_INK.ice, "circle-stroke-opacity": 0.5, "circle-stroke-width": 1 } },
      { id: `${source}-dot`, type: "circle", source, paint: { "circle-radius": 3.5, "circle-color": MAP_INK.ice } },
    ],
  });
  return null;
}
