import { useEffect, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { useDocumentVisible, usePrefersReducedMotion, useScreenActive } from "../../app/core/hooks";
import { freshUrl } from "./client";
import { LiveVideo } from "./LiveVideo";
import type { CameraStream } from "./types";

/** Seconds between views of a panorama strip. */
const VIEW_SECONDS = 5;
const MIN_REFRESH_S = 30;

interface Frame {
  src: string;
  n: number;
}

export interface FeedProps {
  /** The operator's picture URL. Give the component a `key` that changes with it. */
  src: string;
  refreshS: number;
  /** Side-by-side views in one picture (ocean buoys take six); each is shown in turn. */
  frames?: number;
  /** Live video that plays over the picture while the element is on screen. */
  stream?: CameraStream | null;
  alt: string;
  /** Milliseconds before the first load, so a wall of tiles does not fetch in one burst. */
  startDelayMs?: number;
  onFrame?: (at: number) => void;
  onLive?: (live: boolean) => void;
}

/**
 * One camera picture that keeps itself fresh: it asks the operator for a new frame on the operator's own
 * schedule, fades it in and sweeps a scan line across when it arrives. Pauses while hidden.
 */
export function Feed({ src, refreshS, frames = 1, stream = null, alt, startDelayMs = 0, onFrame, onLive }: FeedProps): ReactElement {
  const active = useScreenActive();
  const documentVisible = useDocumentVisible();
  const reduced = usePrefersReducedMotion();
  const run = active && documentVisible;
  const current = useRef<Frame | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [previous, setPrevious] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState(0);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  useEffect(() => {
    if (!run) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const everyMs = Math.max(MIN_REFRESH_S, refreshS) * 1000;

    const load = (): void => {
      const url = freshUrl(src, Math.floor(Date.now() / 1000));
      const probe = new Image();
      probe.referrerPolicy = "no-referrer";
      probe.onload = () => {
        if (!alive) return;
        const next: Frame = { src: url, n: (current.current?.n ?? 0) + 1 };
        setPrevious(current.current?.src ?? null);
        current.current = next;
        setFrame(next);
        setFailed(false);
        onFrameRef.current?.(Date.now());
      };
      probe.onerror = () => {
        // Keep showing the last good frame; only a camera that never answered counts as failed.
        if (alive && !current.current) setFailed(true);
      };
      probe.src = url;
      timer = setTimeout(load, everyMs * (0.95 + Math.random() * 0.1));
    };
    timer = setTimeout(load, startDelayMs);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [run, src, refreshS, startDelayMs]);

  useEffect(() => {
    if (frames < 2 || !run || reduced) return;
    const id = setInterval(() => setView((v) => (v + 1) % frames), VIEW_SECONDS * 1000);
    return () => clearInterval(id);
  }, [frames, run, reduced]);

  const strip = frames > 1;
  const style = strip ? ({ "--frames": frames, "--view": view } as CSSProperties) : undefined;

  return (
    <div className="webcams-feed" data-strip={strip || undefined} style={style}>
      {previous && <img className="webcams-feed__img" src={previous} alt="" referrerPolicy="no-referrer" />}
      {frame && <img key={frame.n} className="webcams-feed__img webcams-feed__img--new" src={frame.src} alt={alt} referrerPolicy="no-referrer" onAnimationEnd={() => setPrevious(null)} />}
      {frame && !reduced && <span key={`wipe-${frame.n}`} className="webcams-feed__wipe" aria-hidden />}
      {stream && <LiveVideo stream={stream} {...(onLive ? { onLive } : {})} />}
      {strip && frame && (
        <span className="webcams-feed__view num">
          VIEW {view + 1}/{frames}
        </span>
      )}
      {failed && <p className="webcams-feed__error">The operator is not serving this camera right now.</p>}
      {!frame && !failed && <span className="webcams-feed__wait" aria-hidden />}
    </div>
  );
}
