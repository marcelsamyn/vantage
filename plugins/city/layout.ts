import { useEffect, useSyncExternalStore, type RefObject } from "react";
import type { Rect } from "./around";
import { useCity } from "./store";

/** City's phone layout: one row of chrome on top, controls and sheets at the bottom, within thumb reach. */
export const PHONE_QUERY = "(max-width: 720px)";

export function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(PHONE_QUERY);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia(PHONE_QUERY).matches,
  );
}

/** Below this size the free area is too small to aim at; pips then use the whole map. */
const MIN_FRAME_PX = 120;

/**
 * The part of the map that no panel covers. On a phone it lies between the top row and the controls above the
 * drawer; on a desktop between the left column, the map controls and the readout. "Around me" centres you in it and
 * puts its edge pips on its border.
 */
export function measureFrame(root: HTMLElement, phone: boolean): Rect {
  const box = root.getBoundingClientRect();
  const rect = (selector: string): DOMRect | null => root.querySelector(selector)?.getBoundingClientRect() ?? null;
  const left = rect(".city-left");
  let frame: Rect;
  if (phone) {
    const bottom = rect(".city-bottom");
    frame = { left: 8, right: box.width - 8, top: (left ? left.bottom - box.top : 0) + 8, bottom: (bottom ? bottom.top - box.top : box.height) - 8 };
  } else {
    const controls = rect(".city-controls");
    // The dock holds the Time machine above the readout: pips stay clear of both.
    const floor = Math.min(rect(".city-hud")?.top ?? box.bottom, rect(".city-dock")?.top ?? box.bottom);
    frame = { left: (left ? left.right - box.left : 0) + 16, top: 16, right: (controls ? controls.left - box.left : box.width) - 12, bottom: floor - box.top - 8 };
  }
  if (frame.right - frame.left < MIN_FRAME_PX || frame.bottom - frame.top < MIN_FRAME_PX) frame = { left: 8, top: 8, right: box.width - 8, bottom: box.height - 8 };
  const round = (r: Rect): Rect => ({ left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) });
  return round(frame);
}

const same = (a: Rect | null, b: Rect): boolean => a !== null && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/**
 * Keep `frame` in the City store current while the chrome around the map changes size: a window resize, a panel
 * that opens, the Time machine unfolding. Bursts of changes settle before the frame moves the map.
 */
export function useFrame(root: RefObject<HTMLElement | null>, phone: boolean, layoutKey: string): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const measure = (): void => {
      const next = measureFrame(el, phone);
      if (!same(useCity.getState().frame, next)) useCity.setState({ frame: next });
    };
    const schedule = (): void => {
      clearTimeout(timer);
      timer = setTimeout(measure, 120);
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    for (const selector of [".city-left", ".city-bottom", ".city-controls", ".city-hud", ".city-dock"]) {
      const part = el.querySelector(selector);
      if (part) observer.observe(part);
    }
    // On a phone the controls slide up with the drawer; the free area is known once they arrive.
    const bottom = el.querySelector(".city-bottom");
    const arrived = (e: Event): void => {
      if (e.target === bottom) schedule();
    };
    bottom?.addEventListener("transitionend", arrived);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      bottom?.removeEventListener("transitionend", arrived);
    };
  }, [root, phone, layoutKey]);
}
