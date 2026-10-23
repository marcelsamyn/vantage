import { Layers, Search as SearchIcon } from "lucide-react";
import { Map as MapLibre, setWorkerUrl, type Map as MapLibreMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { usePrefersReducedMotion, useStoredState } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useIntent, type Intent } from "../../app/core/nav";
import { useProfile } from "../../app/core/profile";
import { useSetting } from "../../app/core/settings";
import { Button, Empty, IconButton, Scanning, Segmented } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { AroundLayer } from "./AroundLayer";
import { AroundList, AroundSheet } from "./AroundList";
import { ContextMenu, type MenuAt } from "./ContextMenu";
import { Controls } from "./Controls";
import type { MapMode } from "./extension";
import { useFollowingOwnsBearing, useMapFacing } from "./Facing";
import { Hud } from "./Hud";
import { LayerHost } from "./LayerHost";
import { LayerPanel, LayerSheet } from "./LayerPanel";
import { useFrame, usePhone } from "./layout";
import { LockOn } from "./Lock";
import { MapControlHost } from "./MapControlHost";
import { useMapTaps } from "./MapTaps";
import { RouteLayer } from "./RouteLayer";
import { Search } from "./Search";
import { settings } from "./settings";
import { useCity } from "./store";
import { loadCityStyle, RELIEF_SOURCE } from "./style";
import { YouLayer } from "./YouLayer";
import "./city.css";

// Served by this plugin's api.ts `assets` entry.
setWorkerUrl("/assets/city/maplibre/maplibre-gl-worker.mjs");

const FALLBACK_CENTER: [number, number] = [-87.6298, 41.8781]; // Chicago, until we know where you are

const MODES: readonly { value: MapMode; label: string }[] = [
  { value: "map", label: "Map" },
  { value: "around", label: "Around me" },
];

export default function CityScreen(): ReactElement {
  const root = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [menu, setMenu] = useState<MenuAt | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useStoredState<MapMode>("city:mode", "map");
  const [layersOpen, setLayersOpen] = useState(false);
  const drawer = useCity((s) => s.drawer);
  const place = useProfile((s) => (s.entity?.kind === "place" ? s.entity.data : null));
  const phone = usePhone();
  const reduced = usePrefersReducedMotion();
  const around = mode === "around";
  const drawn = phone && around;

  useEffect(() => {
    let alive = true;
    let instance: MapLibreMap | null = null;
    setError(null);
    loadCityStyle()
      .then((style) => {
        if (!alive || !container.current) return;
        const here = useLocation.getState().here;
        // Where it knows you are, the map opens high above you, looking straight down, and the first flight to you
        // descends into the city as its buildings rise. Under reduced motion it opens close to where that flight ends.
        const descend = here !== null && !matchMedia("(prefers-reduced-motion: reduce)").matches;
        instance = new MapLibre({
          container: container.current,
          style,
          center: here ? [here.lon, here.lat] : FALLBACK_CENTER,
          zoom: descend ? 13 : here ? 15.4 : 11,
          pitch: descend ? 0 : 58,
          bearing: descend ? 0 : -18,
          maxPitch: 78,
          attributionControl: false,
          fadeDuration: 180,
          // A 3× phone screen would fill 2.25 times the pixels of 2× for detail nobody sees at arm's length; the GPU
          // spends that time on frames instead. Up to 2×, the map follows the screen, also across displays.
          ...(devicePixelRatio > 2 ? { pixelRatio: 2 } : {}),
        });
        const m = instance;
        m.on("load", () => {
          setMap(m);
        });
        m.on("movestart", () => setMenu(null));
      })
      .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      alive = false;
      setMap(null);
      instance?.remove();
    };
  }, [attempt]);

  // A tap on empty map on a phone closes what floats over it and lowers the drawer, so the map gets the room.
  const dismiss = useCallback(() => {
    setMenu(null);
    setSearching(false);
    useCity.setState((s) => ({ selected: null, drawer: { ...s.drawer, snap: "peek" } }));
  }, []);
  useMapTaps(map, phone, { dismiss, menu: setMenu });

  useFollowYou(map, !around);
  useTerrain(map);
  useFrame(root, phone, `${mode}:${map ? "ready" : "loading"}:${drawn ? drawer.snap : ""}`);

  // Intents can arrive before the map exists (the screen is still mounting); hold them until it does.
  const [pending, setPending] = useState<Intent | null>(null);
  useIntent("city", setPending);
  useEffect(() => {
    if (!pending) return;
    if (pending.action === "search" && pending.arg) {
      setSearch(pending.arg);
      setSearching(true);
      setPending(null);
      return;
    }
    if (pending.action === "around" || pending.action === "map") {
      setMode(pending.action);
      setPending(null);
      return;
    }
    if (!map) return;
    if (pending.action === "fly" && pending.arg) {
      const [la, lo, z] = pending.arg.split(",").map(Number);
      if (la !== undefined && lo !== undefined && Number.isFinite(la) && Number.isFinite(lo)) map.flyTo({ center: [lo, la], zoom: z ?? 15, pitch: 60, duration: 3200, essential: true }, USER_NAVIGATION);
    }
    if (pending.action === "locate") {
      const here = useLocation.getState().here;
      if (here) map.flyTo({ center: [here.lon, here.lat], zoom: 16, pitch: 58, duration: 1600 }, USER_NAVIGATION);
    }
    setPending(null);
  }, [pending, map, setMode]);

  // The map controls ride above the drawer: lifted by what it shows beyond its peek, hidden while it covers the map.
  const lift: CSSProperties | undefined = drawn ? ({ "--city-peek": `${drawer.peekPx}px`, "--city-lift": `${Math.max(0, drawer.shownPx - drawer.peekPx)}px` } as CSSProperties) : undefined;

  return (
    <div ref={root} className="city" data-mode={mode} data-drawer={drawn ? drawer.snap : undefined} style={lift}>
      <div ref={container} className="city-map" />
      <div className="city-vignette" aria-hidden />
      {error && (
        <div className="city-center">
          <Empty title="Map unavailable" tone="error" action={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
            {error}
          </Empty>
        </div>
      )}
      {!map && !error && (
        <div className="city-center">
          <Scanning label="Loading city grid" />
        </div>
      )}
      {map && (
        <>
          <CameraRules map={map} around={around} />
          <YouLayer map={map} />
          <RouteLayer map={map} />
          <LockOn map={map} at={menu ?? place} />
          {around ? <AroundLayer map={map} /> : <LayerHost map={map} />}
          <div className="city-left">
            {phone ? (
              // One row on a phone: search folds into a button until you need it. The row keeps a slot on each side,
              // so the mode switch stays centred whether or not the layers button shows.
              <div className="city-bar" data-searching={searching || undefined}>
                {/* Rendered within the tap, so the field takes focus inside it: iOS opens the keyboard only then. */}
                <IconButton label="Search places" className="city-bar__btn" onClick={() => flushSync(() => setSearching(true))}>
                  <SearchIcon size={18} />
                </IconButton>
                <div className="city-mode">
                  <Segmented label="What the map shows" value={mode} options={MODES} onChange={setMode} />
                </div>
                {!around && (
                  <IconButton label="Map layers" className="city-bar__btn" onClick={() => setLayersOpen(true)}>
                    <Layers size={18} />
                  </IconButton>
                )}
                <AnimatePresence>
                  {searching && (
                    <motion.div
                      key="search"
                      className="city-bar__search"
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -12 }}
                      transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.28, bounce: 0 }}
                    >
                      <Search map={map} preset={search} onClose={() => setSearching(false)} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ) : (
              <>
                <Search map={map} preset={search} />
                <div className="city-mode">
                  <Segmented label="What the map shows" value={mode} options={MODES} onChange={setMode} />
                </div>
                {around ? (
                  <section className="v-panel city-around-panel" aria-label="Around me">
                    <AroundList map={map} />
                  </section>
                ) : (
                  <LayerPanel map={map} />
                )}
              </>
            )}
          </div>
          <div className="city-bottom">
            <MapControlHost map={map} mode={mode} />
            <Controls map={map} around={around} />
            <Hud map={map} around={around} />
          </div>
          {drawn && <AroundSheet map={map} />}
          <AnimatePresence>{phone && !around && layersOpen && <LayerSheet map={map} onClose={() => setLayersOpen(false)} />}</AnimatePresence>
          {menu && <ContextMenu at={menu} onClose={() => setMenu(null)} />}
        </>
      )}
    </div>
  );
}

/** Who moves the camera: in Map mode facing your way, it follows you; while it follows, the bearing is not yours to turn. */
function CameraRules({ map, around }: { map: MapLibreMap; around: boolean }): null {
  useMapFacing(map, !around);
  useFollowingOwnsBearing(map);
  return null;
}

/** Raise the terrain while the viewer's setting asks for it. */
function useTerrain(map: MapLibreMap | null): void {
  const raised = useSetting(settings.terrain);
  useEffect(() => {
    map?.setTerrain(raised ? { source: RELIEF_SOURCE, exaggeration: 1 } : null);
  }, [map, raised]);
}

/** Event data that marks a camera move as the user's own navigation, so auto-follow stands down. */
export const USER_NAVIGATION = { userNavigation: true } as const;

/**
 * Map mode: fly to you on the first fix, and again if you move more than 2 km — until you navigate the map yourself
 * (drag, search, a command). The locate button re-centres on demand. "Around me" follows you on its own.
 */
function useFollowYou(map: MapLibreMap | null, enabled: boolean): void {
  const here = useLocation((s) => s.here);
  const last = useRef<{ lat: number; lon: number } | null>(null);
  const held = useRef(false);

  useEffect(() => {
    if (!map) return;
    const hold = (e: { originalEvent?: unknown; userNavigation?: boolean }): void => {
      if (e.originalEvent || e.userNavigation) held.current = true;
    };
    map.on("movestart", hold);
    return () => {
      map.off("movestart", hold);
    };
  }, [map]);

  useEffect(() => {
    // While "Around me" follows you, remember where you are, so returning to the map does not fly anywhere.
    if (!enabled && here) last.current = { lat: here.lat, lon: here.lon };
    if (!map || !here || held.current || !enabled) return;
    if (last.current && distanceM(last.current, here) < 2000) return;
    const first = last.current === null;
    last.current = { lat: here.lat, lon: here.lon };
    map.flyTo({ center: [here.lon, here.lat], zoom: here.source === "gps" ? 16 : 14.5, pitch: 58, bearing: -18, duration: first ? 2600 : 1800, essential: true });
  }, [map, here, enabled]);
}
