import { motion } from "motion/react";
import { useState, type ReactElement, type ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePrefersReducedMotion } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import { Feed } from "./Feed";
import type { CameraStream } from "./types";

export interface TileProps {
  /** Short mono label in the top-left corner, e.g. "CAM 03". */
  tag: string;
  /** Accessible name of the whole tile. */
  label: string;
  src: string;
  refreshS: number;
  frames?: number;
  /** Live video that plays inside the tile; the red REC dot shows only while it plays. */
  stream?: CameraStream | null;
  alt: string;
  /** Position in the grid, used to stagger the entrance and the first loads. */
  index: number;
  selected?: boolean;
  /** Square tile for pictures of a whole planet or star. */
  square?: boolean;
  /** When the spacecraft or operator took the picture, if known. Shown instead of the time since this page loaded it. */
  capturedAt?: number | null;
  /** Mono lines at the bottom of the tile. */
  children: ReactNode;
  /** A short notice over the picture, such as "Night there, sunrise in 4 h". */
  note?: string | null;
  onOpen: () => void;
}

function Age({ loadedAt, capturedAt }: { loadedAt: number | null; capturedAt: number | null }): ReactElement {
  const now = useNow(1000);
  if (capturedAt !== null) return <span title="When the picture was taken">{fmt.ago(capturedAt, now)}</span>;
  if (loadedAt === null) return <span>···</span>;
  const s = Math.max(0, Math.round((now - loadedAt) / 1000));
  return <span title="Time since this page loaded the newest frame">↻ {s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`}</span>;
}

/** One camera on a wall: the picture, a mono overlay, and the frame's age. Click to look closer. */
export function Tile({ tag, label, src, refreshS, frames, stream, alt, index, selected, square, capturedAt = null, children, note, onOpen }: TileProps): ReactElement {
  const reduced = usePrefersReducedMotion();
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [live, setLive] = useState(false);

  return (
    <motion.button
      type="button"
      className="webcams-tile"
      data-selected={selected || undefined}
      data-square={square || undefined}
      aria-label={label}
      initial={reduced ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 12) * 0.05, type: "spring", duration: 0.45, bounce: 0 }}
      onClick={() => {
        sfx.click();
        onOpen();
      }}
    >
      <Feed src={src} refreshS={refreshS} {...(frames ? { frames } : {})} stream={stream ?? null} alt={alt} startDelayMs={index * 350} onFrame={setLoadedAt} onLive={setLive} />
      <span className="webcams-tile__tag num">{tag}</span>
      {live && (
        <span className="webcams-tile__rec num">
          <i aria-hidden /> REC
        </span>
      )}
      {note && <span className="webcams-tile__note">{note}</span>}
      <span className="webcams-tile__meta">
        <span className="webcams-tile__lines">{children}</span>
        <span className="webcams-tile__age num">
          <Age loadedAt={loadedAt} capturedAt={capturedAt} />
        </span>
      </span>
    </motion.button>
  );
}
