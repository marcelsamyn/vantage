import { motion } from "motion/react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { END_YEAR, nearestIndex, rulerStart, rulerTicks, yearToFraction } from "./scale";
import type { EraKind } from "./types";

/** One stop on the ruler. `id` null is today. */
export interface Stop {
  id: string | null;
  year: number;
  label: string;
  kind: EraKind | "today";
}

const SPRING = { type: "spring", duration: 0.5, bounce: 0 } as const;
/** Room one year label needs, so the ruler never prints labels on top of each other. */
const TICK_ROOM_PX = 76;

/**
 * The time machine's dial: a ruler from just before the oldest era to now, with one mark per era. Its length
 * follows the place, so Rome's four decades of aerial photographs get as much room as Ghent's four centuries.
 * Drag along it to scrub; the needle snaps to the nearest era. Diamonds are drawn maps, circles are aerial photographs, rings are views
 * from orbit. Arrow keys step through the eras for anyone who is not using a pointer.
 */
export function Timeline({ stops, activeId, onPick }: { stops: readonly Stop[]; activeId: string | null; onPick: (id: string | null) => void }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(480);

  useEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => entry && setWidth(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Today sits at the right edge; everything else is placed by its year.
  const years = stops.filter((s) => s.kind !== "today").map((s) => s.year);
  const start = rulerStart(years.length > 0 ? Math.min(...years) : END_YEAR - 30);
  const positions = stops.map((s) => (s.kind === "today" ? 1 : yearToFraction(s.year, start)));
  const glide = reduced ? { duration: 0 } : SPRING;
  const activeIndex = Math.max(0, stops.findIndex((s) => s.id === activeId));
  const active = stops[activeIndex];

  const pickAt = (clientX: number): void => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const i = nearestIndex(positions, (clientX - rect.left) / rect.width);
    const stop = stops[i];
    if (stop && stop.id !== activeId) onPick(stop.id);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    pickAt(e.clientX);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (dragging.current) pickAt(e.clientX);
  };
  const stopDragging = (): void => {
    dragging.current = false;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const step = e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      onPick(stops[e.key === "Home" ? 0 : stops.length - 1]?.id ?? null);
      return;
    }
    if (!step) return;
    e.preventDefault();
    const next = stops[Math.min(stops.length - 1, Math.max(0, activeIndex + step))];
    if (next) onPick(next.id);
  };

  return (
    <div
      ref={trackRef}
      className="timemachine-ruler"
      role="slider"
      tabIndex={0}
      aria-label="Era"
      aria-valuemin={0}
      aria-valuemax={Math.max(0, stops.length - 1)}
      aria-valuenow={activeIndex}
      aria-valuetext={active?.label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      onKeyDown={onKeyDown}
    >
      <div className="timemachine-ruler__line" />
      {rulerTicks(start, END_YEAR, Math.floor(width / TICK_ROOM_PX)).map((year) => (
        <motion.span key={year} className="timemachine-ruler__tick num" initial={false} animate={{ left: `${yearToFraction(year, start) * 100}%` }} transition={glide}>
          {year}
        </motion.span>
      ))}
      {stops.map((stop, i) => (
        <motion.span
          key={stop.id ?? "today"}
          className={`timemachine-dot timemachine-dot--${stop.kind}`}
          data-active={i === activeIndex || undefined}
          initial={reduced ? false : { opacity: 0, scale: 0.2, left: `${(positions[i] ?? 0) * 100}%` }}
          animate={{ opacity: 1, scale: 1, left: `${(positions[i] ?? 0) * 100}%` }}
          transition={{ ...glide, delay: reduced ? 0 : Math.min(i, 24) * 0.02 }}
        />
      ))}
      <motion.div className="timemachine-needle" initial={false} animate={{ left: `${(positions[activeIndex] ?? 1) * 100}%` }} transition={glide}>
        <span className="timemachine-needle__flag num">{active?.kind === "today" ? "Today" : active?.label.split(" · ")[0]}</span>
      </motion.div>
    </div>
  );
}
