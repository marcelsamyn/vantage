import { Navigation, Navigation2 } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { feed } from "../../app/core/feed";
import { noCompassReason, requestCompass, unwrapDeg, useCompass, useHeading } from "../../app/core/heading";
import { useLocation } from "../../app/core/location";
import { IconButton } from "../../app/ui";
import { useCity } from "./store";

/** Turn the map with you: ask for the compass (from the tap that calls this), then follow you facing your way. */
function faceYourWay(): void {
  requestCompass()
    .then((state) => {
      const reason = noCompassReason(state);
      if (reason) {
        feed({ level: "alert", source: "city", title: "The map cannot turn with you", detail: reason }, { key: `city:compass:${state}`, toast: true });
        return;
      }
      useCompass.getState().setEnabled(true);
      useCity.setState({ following: true });
    })
    .catch((err: unknown) => feed({ level: "alert", source: "city", title: "The compass did not start", detail: errorMessage(err) }, { toast: true }));
}

export function setHeadingMode(map: MapLibreMap, mode: "north" | "facing"): void {
  if (mode === "facing") return faceYourWay();
  useCompass.getState().setEnabled(false);
  map.easeTo({ bearing: 0, duration: 600 });
}

/**
 * The map's compass control, the one place to choose the map's direction. A turned map points north on the first
 * tap; the next tap turns the map with you (following you), and the next brings north back up. Where the map cannot
 * turn with you, that tap says why in a toast, so a phone without hover learns it too.
 */
export function CompassButton({ map }: { map: MapLibreMap }): ReactElement {
  const [north, setNorth] = useState(() => Math.abs(map.getBearing()) < 0.5);
  const needle = useRef<SVGSVGElement>(null);
  const turned = useRef<number | null>(null);
  const enabled = useCompass((s) => s.enabled);
  const state = useCompass((s) => s.state);
  const reason = noCompassReason(state);
  // A remembered "facing" counts once the compass runs; on iOS after a reload the next tap asks for it again.
  const facing = enabled && state === "ready";
  const canSwitchOff = enabled && state !== "ask";

  // The needle turns with every frame of a rotation. It is turned in the DOM, so React renders only when the map
  // comes to north or leaves it; unwrapped, so passing south does not spin it the long way round.
  useLayoutEffect(() => {
    const update = (): void => {
      setNorth(Math.abs(map.getBearing()) < 0.5);
      turned.current = unwrapDeg(turned.current, -map.getBearing());
      needle.current?.style.setProperty("rotate", `${turned.current.toFixed(1)}deg`);
    };
    update();
    map.on("rotate", update);
    return () => {
      map.off("rotate", update);
    };
  }, [map, facing]);

  const label = canSwitchOff ? "Switch phone orientation off in Map, Around me and Sky" : !north ? "Point north" : reason ? `North up. ${reason}` : "Use phone orientation in Map, Around me and Sky";
  return (
    <IconButton
      label={label}
      on={enabled}
      onClick={() => {
        if (canSwitchOff) setHeadingMode(map, "north");
        else if (!north) map.easeTo({ bearing: 0, duration: 700 });
        else setHeadingMode(map, "facing");
      }}
    >
      {facing ? <Navigation size={16} /> : <Navigation2 ref={needle} size={16} style={{ transition: "rotate 80ms linear" }} />}
    </IconButton>
  );
}

/**
 * Map mode facing your way: while following, the map stays on you and turns with your heading. Your own pan, search
 * or rotation stops the following; the locate button resumes it. "Around me" does the same in its own camera.
 */
export function useMapFacing(map: MapLibreMap, active: boolean): void {
  const following = useCity((s) => s.following);
  const enabled = useCompass((s) => s.enabled);
  const tracking = active && following && enabled;
  const heading = useHeading(tracking);
  const here = useLocation((s) => s.here);

  // Map mode follows you only while it faces your way: back to north up, the map stays where you put it.
  useEffect(() => {
    if (active && following && !enabled) useCity.setState({ following: false });
  }, [active, following, enabled]);

  useEffect(() => {
    if (!active) return;
    const stop = (): void => useCity.setState({ following: false });
    const onMove = (e: { originalEvent?: unknown; userNavigation?: boolean }): void => {
      if (e.userNavigation) stop();
    };
    map.on("dragstart", stop);
    map.on("movestart", onMove);
    return () => {
      map.off("dragstart", stop);
      map.off("movestart", onMove);
    };
  }, [map, active]);

  const started = useRef(false);
  const stepped = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!tracking) {
      started.current = false;
      return;
    }
    if (!here) return;
    const first = !started.current;
    started.current = true;
    const moved = stepped.current?.lat !== here.lat || stepped.current.lon !== here.lon;
    stepped.current = { lat: here.lat, lon: here.lon };
    const camera = { center: [here.lon, here.lat] as [number, number], ...(heading !== null ? { bearing: heading } : {}), essential: true };
    if (first) map.easeTo({ ...camera, zoom: Math.max(map.getZoom(), 16), duration: 900 });
    else map.easeTo({ ...camera, ...(moved ? STEP : TURN) });
  }, [map, tracking, here?.lat, here?.lon, heading]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * Easing for a camera that keeps chasing a moving target: your heading, your position. Each new ease cuts the last
 * one short. The default ease starts slowly, so the camera would hitch at every cut; an exponential ease starts at
 * the speed the cut one had reached, so a turn every 66 ms still glides.
 */
const chase = (t: number): number => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/** A step toward your new position while the map follows you. */
export const STEP = { duration: 700, easing: chase } as const;

/**
 * A turn toward your new heading while the map follows you. Turns share an `easeId`, so a stream of them is one
 * camera move, and `moveend` listeners (every layer's view, pulse hit tests) wait until the turning settles.
 */
export const TURN = { duration: 600, easing: chase, easeId: "city-turn" } as const;

/**
 * While the map follows you it owns the bearing (north up, or your heading): a pinch only zooms, so a twist of the
 * fingers cannot fight the compass. Turning the map with a mouse hands the camera back to you.
 */
export function useFollowingOwnsBearing(map: MapLibreMap): void {
  const following = useCity((s) => s.following);
  useEffect(() => {
    if (!following) return;
    map.touchZoomRotate.disableRotation();
    const yours = (e: { originalEvent?: unknown }): void => {
      if (e.originalEvent) useCity.setState({ following: false });
    };
    map.on("rotatestart", yours);
    return () => {
      map.off("rotatestart", yours);
      if (map.style) map.touchZoomRotate.enableRotation();
    };
  }, [map, following]);
}
