import { Map as MapLibre, type Map as MapLibreMap, type StyleSpecification } from "maplibre-gl";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { EraSheet, type Look } from "./era-sheet";
import { clampSplit, splitForKey, splitText } from "./slider";
import type { Era } from "./types";

const FADE_MS = 520;
const EMPTY_STYLE: StyleSpecification = { version: 8, sources: {}, layers: [] };

function clip(host: HTMLElement, split: number): void {
  host.style.clipPath = `inset(0 ${((1 - split) * 100).toFixed(3)}% 0 0)`;
}

export interface SwipeProps {
  /** The map that shows today. The past is drawn on a second, transparent map laid over it. */
  map: MapLibreMap;
  era: Era;
  look: Look;
  /** Where the divider rests, 0–1 from the left edge. */
  split: number;
  /** Called when a drag or key press settles. */
  onSplit: (split: number) => void;
  thenLabel: string;
  nowLabel: string;
}

/**
 * Wipe between then and now. The past is a second map with only the historical raster in it, moved with
 * the camera of the first and clipped with CSS. The clip runs on the compositor, so dragging the divider
 * never touches the map's render loop; only camera moves cost a second draw.
 */
export function Swipe({ map, era, look, split, onSplit, thenLabel, nowLabel }: SwipeProps): ReactElement {
  const reduced = usePrefersReducedMotion();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const live = useRef(split);
  /** Set once the overlay map has loaded; null while it is still starting. */
  const [sheet, setSheet] = useState<EraSheet | null>(null);

  useEffect(() => {
    // React runs this effect twice in development; a map that was removed in between must not report ready.
    let alive = true;
    const host = document.createElement("div");
    host.className = "timemachine-sheet";
    clip(host, live.current);
    // Straight after the canvas and before any marker, so "you are here" still shows through the past.
    map.getCanvasContainer().insertBefore(host, map.getCanvas().nextSibling);

    const camera = (): { center: [number, number]; zoom: number; bearing: number; pitch: number } => {
      const c = map.getCenter();
      return { center: [c.lng, c.lat], zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    };
    const then = new MapLibre({ container: host, style: EMPTY_STYLE, interactive: false, attributionControl: false, fadeDuration: 0, maxPitch: 85, ...camera() });
    const follow = (): void => {
      then.jumpTo(camera());
      // Draw now rather than next frame, so both maps show the same camera in the same frame.
      then.redraw();
    };
    map.on("move", follow);

    const eraSheet = new EraSheet(then, false, reduced ? 0 : FADE_MS);
    hostRef.current = host;
    then.once("load", () => {
      if (!alive) return;
      follow();
      setSheet(eraSheet);
    });

    return () => {
      alive = false;
      map.off("move", follow);
      eraSheet.dispose();
      hostRef.current = null;
      then.remove();
      host.remove();
      setSheet(null);
    };
  }, [map, reduced]);

  useEffect(() => {
    sheet?.show(era, { tint: look.tint, strength: look.strength });
  }, [sheet, era, look.tint, look.strength]);

  useEffect(() => {
    if (sheet && hostRef.current) hostRef.current.dataset.ready = "true";
  }, [sheet]);

  const move = (fraction: number): void => {
    live.current = fraction;
    if (hostRef.current) clip(hostRef.current, fraction);
  };

  return createPortal(<Divider container={map.getContainer()} split={split} onMove={move} onSettle={onSplit} thenLabel={thenLabel} nowLabel={nowLabel} />, map.getContainer());
}

function Divider({
  container,
  split,
  onMove,
  onSettle,
  thenLabel,
  nowLabel,
}: {
  container: HTMLElement;
  split: number;
  onMove: (fraction: number) => void;
  onSettle: (fraction: number) => void;
  thenLabel: string;
  nowLabel: string;
}): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const position = useRef(split);
  const dragging = useRef(false);
  const [held, setHeld] = useState(false);
  /** Mirrors the divider for assistive technology. It follows a drag, which the stored `split` only does on release. */
  const [shown, setShown] = useState(split);

  // The position is written to the DOM directly while dragging; React only places it when the stored value changes.
  useLayoutEffect(() => {
    position.current = split;
    setShown(split);
    if (rootRef.current) rootRef.current.style.left = `${split * 100}%`;
  }, [split]);

  const place = (fraction: number): void => {
    const f = clampSplit(fraction);
    position.current = f;
    setShown(f);
    if (rootRef.current) rootRef.current.style.left = `${f * 100}%`;
    onMove(f);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    setHeld(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return;
    const rect = container.getBoundingClientRect();
    place((e.clientX - rect.left) / rect.width);
  };
  const release = (): void => {
    if (!dragging.current) return;
    dragging.current = false;
    setHeld(false);
    onSettle(position.current);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const next = splitForKey(e.key, position.current);
    if (next === null) return;
    e.preventDefault();
    place(next);
    onSettle(position.current);
  };

  return (
    <div ref={rootRef} className="timemachine-split" data-held={held || undefined}>
      <span className="timemachine-split__tag timemachine-split__tag--then">{thenLabel}</span>
      <span className="timemachine-split__tag timemachine-split__tag--now">{nowLabel}</span>
      <div
        className="timemachine-split__grip"
        role="slider"
        tabIndex={0}
        aria-label="Divider between then and now"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
        aria-valuetext={splitText(shown)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={release}
        onPointerCancel={release}
        onKeyDown={onKeyDown}
      >
        <span className="timemachine-split__handle" aria-hidden>
          <svg width="22" height="14" viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="square">
            <path d="M7 2 2 7l5 5M15 2l5 5-5 5" />
          </svg>
        </span>
      </div>
    </div>
  );
}
