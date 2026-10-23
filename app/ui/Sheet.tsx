import { animate, motion, useMotionValue, usePresence, useTransform } from "motion/react";
import { createContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactElement, type ReactNode } from "react";
import { usePrefersReducedMotion } from "../core/hooks";
import { bySize, nextSnap, resist, settleAt, snapOffset, type SheetMetrics, type SnapPoint, type Stop } from "./sheet-snap";

export type { SnapPoint } from "./sheet-snap";

/** True inside a bottom sheet: cards drop their floating chrome and enter with opacity only, since the sheet moves them. */
export const InSheetContext = createContext(false);

/** Pixels a press must travel before it becomes a drag, so taps on buttons inside the sheet still click. */
const DRAG_SLOP = 6;
/** A finger that rests this long before letting go has no flick left in it. */
const STILL_MS = 90;
const FOCUSABLE = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
/** Parts of the content that drag the sheet like its header, such as a profile's coloured band. */
const DRAG_PARTS = "[data-sheet-head], .v-profiler__band";
const SIZE_WORDS: Record<SnapPoint, string> = { peek: "Lowered", half: "Half height", full: "Full height" };

interface Drag {
  startY: number;
  startOffset: number;
  lastY: number;
  lastT: number;
  velocity: number;
  active: boolean;
}

/**
 * The bottom sheet for phones. It sits above the tab bar and the feed ticker and rests at its snap points: `peek`
 * (the header and the first row of content), `half` and `full`. A sheet with one snap point fits its content.
 *
 * - The header (the handle and `head`) drags it; so does the content, when it is scrolled to the top and the
 *   gesture goes down. A release snaps by position, a flick by its direction.
 * - The content scrolls at every snap point. A gesture is either a drag or a scroll from its first move on, and the
 *   scroll belongs to the browser, so no drag can leave the content unable to scroll.
 * - The handle is a button: tap it, or press Enter or Space, to step through the snap points.
 * - With `onClose` the sheet is modal: a scrim dims the screen, focus stays inside, and a tap on the scrim or a drag
 *   below the lowest snap closes it. Render a modal sheet as the direct child of `AnimatePresence` so it can slide out.
 * - Only `transform` and `opacity` animate, and nothing animates under reduced motion.
 */
export function Sheet({
  label,
  snaps = ["full"],
  snap: wanted,
  onSnap,
  onClose,
  peekBody = 0,
  className,
  head,
  children,
}: {
  label: string;
  /** Where the sheet can rest. */
  snaps?: readonly SnapPoint[];
  /** The snap point to rest at, for a sheet its owner moves; the first in `snaps` when unset. */
  snap?: SnapPoint;
  /** Called whenever the sheet settles, with the height it shows and the height it shows at its peek. */
  onSnap?: (snap: SnapPoint, shownPx: number, peekPx: number) => void;
  onClose?: () => void;
  /** Pixels of content that a peeking sheet shows under its header. */
  peekBody?: number;
  className?: string;
  /** Header content beside and under the handle, such as a title or tabs. It drags the sheet. */
  head?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const reduced = usePrefersReducedMotion();
  const [isPresent, safeToRemove] = usePresence();
  const modal = onClose !== undefined;
  const sorted = bySize(snaps);
  const lowest = sorted[0] ?? "full";
  const expandable = sorted.length > 1;

  const frame = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const metrics = useRef<SheetMetrics>({ height: 0, room: 0, peek: 0 });
  const drag = useRef<Drag | null>(null);
  const exiting = useRef(false);
  const [snap, setSnap] = useState<SnapPoint>(wanted ?? lowest);
  const snapRef = useRef(snap);
  const [hidden, setHidden] = useState(0);
  const y = useMotionValue(window.innerHeight);

  // Kept in refs, so listeners attached once always see the current props.
  const latest = useRef({ snaps: sorted, onSnap, onClose, reduced, peekBody, present: isPresent });
  latest.current = { snaps: sorted, onSnap, onClose, reduced, peekBody, present: isPresent };

  const offset = (s: SnapPoint): number => snapOffset(s, metrics.current);
  const closedOffset = (): number => metrics.current.height + 24;

  const measure = (): void => {
    const m = metrics.current;
    m.height = panel.current?.offsetHeight ?? 0;
    m.room = frame.current?.clientHeight ?? 0;
    m.peek = (header.current?.offsetHeight ?? 0) + latest.current.peekBody;
  };

  /** Rest at `s`. The content's bottom padding equals the part of the panel below the screen, so its last row can scroll into view. */
  const settle = (s: SnapPoint, how: "animate" | "jump" = "animate"): void => {
    const target = offset(s);
    snapRef.current = s;
    setSnap(s);
    latest.current.onSnap?.(s, Math.max(0, metrics.current.height - target), Math.min(metrics.current.height, metrics.current.peek));
    // Growing the content's padding is harmless at once; shrinking it waits until the panel arrives, or the list jumps.
    if (target >= y.get()) setHidden(target);
    if (how === "jump" || latest.current.reduced) {
      y.set(target);
      setHidden(target);
      return;
    }
    void animate(y, target, { type: "spring", duration: 0.42, bounce: 0 }).then(() => {
      if (snapRef.current === s) setHidden(target);
    });
  };

  // The scrim fades as a modal sheet goes below its lowest stop, so a drag down visibly lets go of the page.
  const scrim = useTransform(y, (v) => {
    const rest = snapOffset(lowest, metrics.current);
    const span = Math.max(1, closedOffset() - rest);
    return v <= rest ? 1 : Math.max(0, 1 - (v - rest) / span);
  });

  useLayoutEffect(() => {
    const el = panel.current;
    if (!el) return;
    measure();
    y.set(metrics.current.room || window.innerHeight);
    settle(snapRef.current);
    // Content and window changes move the resting places; follow them unless a finger holds the sheet or it is leaving.
    // The move waits for the next frame: resizing inside the observer's own callback would start a resize loop.
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const before = { ...metrics.current };
        measure();
        const m = metrics.current;
        if (m.height === before.height && m.room === before.room && m.peek === before.peek) return;
        if (!drag.current?.active && !exiting.current) settle(snapRef.current, "jump");
      });
    });
    observer.observe(el);
    if (frame.current) observer.observe(frame.current);
    if (header.current) observer.observe(header.current);
    const stop = (): void => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    if (!modal) return stop;
    // Keyboard and screen-reader users land in a modal sheet, and return to what opened it once it is gone.
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    el.focus({ preventScroll: true });
    return () => {
      stop();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The owner moves the sheet.
  useEffect(() => {
    if (wanted && wanted !== snapRef.current && !drag.current?.active) settle(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  useEffect(() => {
    if (isPresent) {
      // Reopened while it was sliding out: come back to where it was.
      if (exiting.current) settle(snapRef.current);
      exiting.current = false;
      return;
    }
    exiting.current = true;
    void animate(y, closedOffset(), reduced ? { duration: 0 } : { type: "spring", duration: 0.32, bounce: 0 }).then(() => {
      if (exiting.current) safeToRemove();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPresent]);

  // ── Dragging ──────────────────────────────────────────────────

  const begin = (clientY: number, t: number): Drag => {
    const d: Drag = { startY: clientY, startOffset: y.get(), lastY: clientY, lastT: t, velocity: 0, active: false };
    drag.current = d;
    return d;
  };

  /** Follow the pointer. Returns false while the press is still within the slop. */
  const follow = (d: Drag, clientY: number, t: number): boolean => {
    const dy = clientY - d.startY;
    if (!d.active) {
      if (Math.abs(dy) < DRAG_SLOP) return false;
      d.active = true;
      y.stop();
      // A mouse drag would otherwise select the text it passes over.
      frame.current?.setAttribute("data-dragging", "");
      window.getSelection()?.removeAllRanges();
    }
    // A modal sheet follows the finger all the way out; any sheet resists past its top, a drawer past its peek.
    y.set(resist(d.startOffset + dy, 0, modal ? Number.POSITIVE_INFINITY : offset(lowest)));
    const step = t - d.lastT;
    if (step > 0) d.velocity = 0.7 * ((clientY - d.lastY) / step) + 0.3 * d.velocity;
    d.lastY = clientY;
    d.lastT = t;
    return true;
  };

  const finish = (d: Drag, t: number, cancelled: boolean): void => {
    drag.current = null;
    if (!d.active) return;
    frame.current?.removeAttribute("data-dragging");
    if (cancelled) return settle(snapRef.current);
    const velocity = t - d.lastT > STILL_MS ? 0 : d.velocity;
    const stops: Stop<SnapPoint | "closed">[] = latest.current.snaps.map((id) => ({ id, y: offset(id) }));
    if (modal) stops.push({ id: "closed", y: closedOffset() });
    const to = settleAt(stops, y.get(), velocity);
    if (to === "closed") latest.current.onClose?.();
    else settle(to);
  };

  /** The release of a drag is not a tap on whatever lies under it. */
  const swallowClick = (): void => {
    const swallow = (click: MouseEvent): void => click.stopPropagation();
    window.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
  };

  // Mouse and pen anywhere, and touch on the header: pointer events, followed on the window so a drag keeps going
  // when the pointer leaves the sheet. The header has `touch-action: none`, so the browser never takes those over.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 || !isPresent || drag.current) return;
    const target = e.target as Element;
    const onHead = target.closest(DRAG_PARTS) !== null;
    const inBody = body.current?.contains(target) ?? false;
    // Touches in the content are the touch handler's: they may be scrolls.
    if (!onHead && (e.pointerType === "touch" || !inBody)) return;
    const d = begin(e.clientY, e.timeStamp);
    const id = e.pointerId;
    const move = (ev: globalThis.PointerEvent): void => {
      if (ev.pointerId !== id || drag.current !== d) return;
      // A mouse press in the content drags only from the top of the scroll, and only downward.
      if (!onHead && !d.active && (ev.clientY - d.startY < 0 || (body.current?.scrollTop ?? 0) > 0)) {
        if (Math.abs(ev.clientY - d.startY) >= DRAG_SLOP) stop(ev, true);
        return;
      }
      follow(d, ev.clientY, ev.timeStamp);
    };
    const stop = (ev: globalThis.PointerEvent, abandon = false): void => {
      if (ev.pointerId !== id) return;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      if (abandon) {
        drag.current = null;
        return;
      }
      if (d.active) swallowClick();
      finish(d, ev.timeStamp, ev.type === "pointercancel");
    };
    const up = (ev: globalThis.PointerEvent): void => stop(ev);
    const cancel = (ev: globalThis.PointerEvent): void => stop(ev);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  // Touch in the content: the first move decides. Down from the top of the scroll drags the sheet, and the handler
  // keeps the browser from scrolling for the rest of that touch; anything else is the browser's scroll, untouched.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    let touch: { id: number; x: number; y: number; mine: boolean | null; drag: Drag | null } | null = null;
    const start = (e: TouchEvent): void => {
      const t = e.changedTouches[0];
      // A sheet sliding out takes no new drag.
      if (!t || !latest.current.present || e.touches.length > 1 || drag.current || (e.target as Element).closest(DRAG_PARTS)) {
        touch = null;
        return;
      }
      touch = { id: t.identifier, x: t.clientX, y: t.clientY, mine: null, drag: null };
    };
    const find = (e: TouchEvent): Touch | undefined => [...e.changedTouches].find((t) => t.identifier === touch?.id);
    const move = (e: TouchEvent): void => {
      const t = find(e);
      if (!touch || !t || touch.mine === false) return;
      if (touch.mine === null) {
        const dy = t.clientY - touch.y;
        const dx = t.clientX - touch.x;
        if (Math.abs(dy) < 2 && Math.abs(dx) < 2) return;
        touch.mine = e.cancelable && dy > 0 && Math.abs(dy) > Math.abs(dx) && el.scrollTop <= 0;
        if (!touch.mine) return;
        touch.drag = begin(touch.y, e.timeStamp);
      }
      e.preventDefault();
      if (touch.drag) follow(touch.drag, t.clientY, e.timeStamp);
    };
    const end = (e: TouchEvent): void => {
      const t = find(e);
      if (!touch || !t) return;
      const d = touch.drag;
      touch = null;
      if (d) finish(d, e.timeStamp, e.type === "touchcancel");
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const next = nextSnap(sorted, snap);
  const grows = sorted.indexOf(next) > sorted.indexOf(snap);

  return (
    <div
      ref={frame}
      className={["v-sheet", className].filter(Boolean).join(" ")}
      data-snap={snap}
      data-modal={modal || undefined}
      data-expandable={expandable || undefined}
      style={{ "--sheet-hidden": `${hidden}px` } as CSSProperties}
    >
      {modal && <motion.div className="v-sheet__scrim" style={{ opacity: scrim }} onClick={onClose} aria-hidden />}
      <motion.div
        ref={panel}
        className="v-sheet__panel"
        style={{ y }}
        role={modal ? "dialog" : "region"}
        aria-modal={modal || undefined}
        aria-label={label}
        tabIndex={modal ? -1 : undefined}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          // Tab stays inside a modal sheet while it is open, as in any modal dialog.
          if (!modal || e.key !== "Tab") return;
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = items[0];
          const last = items[items.length - 1];
          const at = document.activeElement;
          if (!first || !last) e.preventDefault();
          else if (e.shiftKey && (at === first || at === e.currentTarget)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && at === last) {
            e.preventDefault();
            first.focus();
          }
        }}
      >
        <div ref={header} className="v-sheet__head" data-sheet-head>
          {expandable ? (
            <button type="button" className="v-sheet__handle" aria-label={`${SIZE_WORDS[snap]}. ${grows ? "Show more" : "Show less"}`} title={grows ? "Show more" : "Show less"} onClick={() => settle(next)}>
              <span className="v-sheet__grabber" aria-hidden />
            </button>
          ) : (
            <span className="v-sheet__handle" aria-hidden>
              <span className="v-sheet__grabber" />
            </span>
          )}
          {head}
        </div>
        <div ref={body} className="v-sheet__body">
          <InSheetContext.Provider value={true}>{children}</InSheetContext.Provider>
        </div>
      </motion.div>
    </div>
  );
}
