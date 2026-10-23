import { Map as MapLibre, setWorkerUrl, type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useLocation } from "../../app/core/location";
import { Button, Empty, Scanning } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { showEra } from "./actions";
import { useEras } from "./client";
import type { Look } from "./era-sheet";
import { Swipe } from "./Swipe";
import type { Era } from "./types";
import "./timemachine.css";

// Served by the City plugin's api.ts; the same worker the City map uses.
setWorkerUrl("/assets/city/maplibre/maplibre-gl-worker.mjs");

const NIGHT_STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const LOOK: Look = { tint: "true", strength: 1 };

/** "Then and now": the oldest picture of where you are, with today's map beside it to swipe between. */
export default function ThenAndNowTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const at = useMemo<LatLon | null>(() => (here ? { lat: here.lat, lon: here.lon } : null), [here]);
  const { eras, settled, error, retry } = useEras(at, 0);

  if (!at) return status === "locating" ? <Scanning label="Locating" /> : <Empty title="Location unknown">Time machine needs to know where you are. Pin a place from the command palette.</Empty>;
  if (error && eras.length === 0)
    return (
      <Empty
        title="Could not look up the past"
        tone="error"
        action={
          <Button size="sm" onClick={retry}>
            Try again
          </Button>
        }
      >
        {error}
      </Empty>
    );
  if (!settled && eras.length === 0) return <Scanning label="Looking back" />;

  const oldest = eras.find((e) => e.kind !== "orbit");
  if (!oldest) return <Empty title="Nothing older here">No historical map or aerial photo is published for your spot. Open the City map and try Brussels, Paris, Zurich or Rome.</Empty>;

  return <Compare at={at} era={oldest} />;
}

function Compare({ at, era }: { at: LatLon; era: Era }): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [split, setSplit] = useState(0.5);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let instance: MapLibreMap | null = null;
    setFailed(null);
    fetch(NIGHT_STYLE_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`The night map style is unavailable (HTTP ${res.status}). Check your internet connection.`);
        return res.json() as Promise<StyleSpecification>;
      })
      .then((style) => {
        if (!alive || !host.current) return;
        instance = new MapLibre({ container: host.current, style, center: [at.lon, at.lat], zoom: Math.max(era.viewZoom, era.minzoom), interactive: false, attributionControl: false, fadeDuration: 0 });
        instance.once("load", () => alive && instance && setMap(instance));
      })
      .catch((err: unknown) => alive && setFailed(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
      setMap(null);
      instance?.remove();
    };
  }, [at.lat, at.lon, era.minzoom, era.viewZoom]);

  if (failed) return <Empty title="Map unavailable" tone="error">{failed}</Empty>;

  return (
    <div className="timemachine-mini">
      <div className="timemachine-mini-frame">
        <div ref={host} className="timemachine-mini-map" />
        {map && <Swipe map={map} era={era} look={LOOK} split={split} onSplit={setSplit} thenLabel={era.label} nowLabel="Today" />}
      </div>
      <div className="timemachine-mini-foot">
        <p className="timemachine-mini-credit num">
          {era.publisher} · {era.licence}
        </p>
        <Button size="sm" onClick={() => showEra(era, at)}>
          Open in City map
        </Button>
      </div>
    </div>
  );
}
