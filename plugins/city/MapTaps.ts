import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { profile } from "../../app/core/profile";
import { TOUCH_RADIUS_PX } from "./hit";
import { routeTap } from "./layer-kit";

/** How long a finger rests on the map before it drops a pin. */
const LONG_PRESS_MS = 500;
/** A press that moves further than this is a pan, not a long press. */
const PRESS_SLOP_PX = 8;

export interface TapActions {
  /** A tap on empty map on a phone or touch screen: close menus and lower sheets. */
  dismiss: () => void;
  /** A right-click opens the context menu at a point; any click closes it (null). */
  menu: (at: { x: number; y: number; lat: number; lon: number } | null) => void;
}

function openPin(lat: number, lon: number): void {
  profile.open({ kind: "place", id: `${lat.toFixed(5)},${lon.toFixed(5)}`, data: { lat, lon, name: "Dropped pin", context: "", area: "", kind: "point", countryCode: null } });
}

/**
 * Taps and clicks on the City map.
 * - A tap goes to the nearest clickable thing it reached; a touch reaches 16 px around the fingertip.
 * - With a mouse on a large screen, a click on empty map drops a pin and opens its place profile, and a right-click
 *   opens the context menu.
 * - On a phone or with touch, a tap on empty map only closes menus and lowers sheets, so a missed tap on a bus opens
 *   nothing. A long press drops the pin instead.
 */
export function useMapTaps(map: MapLibreMap | null, phone: boolean, actions: TapActions): void {
  const latest = useRef({ phone, ...actions });
  latest.current = { phone, ...actions };

  useEffect(() => {
    if (!map) return;
    const box = map.getCanvasContainer();
    let pointer = "mouse";
    let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let pinned = false;
    const touchLike = (): boolean => pointer === "touch" || latest.current.phone;

    const cancel = (): void => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    /** Drop the pin. The lift of the same finger must not tap what now lies under it, such as the profile's scrim. */
    const pin = (lat: number, lon: number): void => {
      pinned = true;
      openPin(lat, lon);
      const swallow = (click: MouseEvent): void => {
        click.stopPropagation();
        click.preventDefault();
      };
      const release = (): void => window.removeEventListener("click", swallow, { capture: true });
      const lift = (): void => {
        window.removeEventListener("pointerup", lift, true);
        window.removeEventListener("pointercancel", lift, true);
        setTimeout(release, 400);
      };
      window.addEventListener("click", swallow, { capture: true });
      window.addEventListener("pointerup", lift, true);
      window.addEventListener("pointercancel", lift, true);
      setTimeout(release, 5000);
    };
    const onDown = (e: PointerEvent): void => {
      pointer = e.pointerType;
      cancel();
      pinned = false;
      // Two fingers are a pinch; a right button is the context menu.
      if (!e.isPrimary || e.button !== 0 || !touchLike()) return;
      const at = { x: e.clientX, y: e.clientY };
      press = {
        id: e.pointerId,
        ...at,
        timer: setTimeout(() => {
          press = null;
          const r = box.getBoundingClientRect();
          const { lat, lng } = map.unproject([at.x - r.left, at.y - r.top]);
          pin(lat, lng);
        }, LONG_PRESS_MS),
      };
    };
    const onMove = (e: PointerEvent): void => {
      if (press && e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > PRESS_SLOP_PX) cancel();
    };
    // Only your own pan or zoom ends a press: the map following you or turning with the compass moves it too.
    const onCamera = (e: { originalEvent?: unknown }): void => {
      if (e.originalEvent) cancel();
    };

    const onClick = (e: { point: { x: number; y: number }; lngLat: { lat: number; lng: number } }): void => {
      // The lift after a long press is not a tap.
      if (pinned) {
        pinned = false;
        return;
      }
      latest.current.menu(null);
      const touch = pointer === "touch";
      if (routeTap(map, e.point, touch ? TOUCH_RADIUS_PX : 0)) return;
      if (touchLike()) latest.current.dismiss();
      else openPin(e.lngLat.lat, e.lngLat.lng);
    };
    const onContext = (e: { preventDefault: () => void; point: { x: number; y: number }; lngLat: { lat: number; lng: number } }): void => {
      e.preventDefault();
      // Touch browsers that know long presses say so here, sometimes before the timer: either one drops the pin, once.
      if (pointer === "touch") {
        if (!pinned) {
          cancel();
          pin(e.lngLat.lat, e.lngLat.lng);
        }
        return;
      }
      latest.current.menu({ x: e.point.x, y: e.point.y, lat: e.lngLat.lat, lon: e.lngLat.lng });
    };

    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", cancel);
    box.addEventListener("pointercancel", cancel);
    map.on("click", onClick);
    map.on("contextmenu", onContext);
    map.on("movestart", onCamera);
    return () => {
      cancel();
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", cancel);
      box.removeEventListener("pointercancel", cancel);
      map.off("click", onClick);
      map.off("contextmenu", onContext);
      map.off("movestart", onCamera);
    };
  }, [map]);
}
