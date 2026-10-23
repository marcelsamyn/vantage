import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { useHotkey } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { sfx } from "../../app/core/sound";
import { IconButton, Readout, type MaybeRow } from "../../app/ui";
import { Feed } from "./Feed";
import { siteOf } from "./items";
import type { CameraStream, Webcam } from "./types";

/** What the focus view needs to show one camera or one spacecraft picture. */
export interface FocusItem {
  key: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  src: string;
  refreshS: number;
  frames?: number;
  stream?: CameraStream | null;
  square?: boolean;
  rows: MaybeRow[];
  note?: string | null;
  about?: string;
  license: string;
  /** Opens the profiler beside the view. Spacecraft pictures have none. */
  camera?: Webcam;
}

/**
 * A large view of one camera, with arrows to hop to the next one (the Watch Dogs move).
 * Playing live video when the operator offers it, and opening the profiler beside it.
 */
export function Focus({ items, index, onIndex, onClose }: { items: readonly FocusItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }): ReactElement | null {
  const item = items[index];
  const [live, setLive] = useState(false);
  const camera = item?.camera;
  const profiled = useProfile((s) => s.entity?.kind === "webcam");
  const panel = useRef<HTMLElement>(null);

  // Move focus into the dialog and give it back to the tile that opened it.
  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.current?.focus();
    return () => before?.focus();
  }, []);

  // The profiler slot covers a narrow screen, and the large view already carries the same details there.
  useEffect(() => {
    if (camera && matchMedia("(min-width: 1100px)").matches) profile.open({ kind: "webcam", id: camera.id, data: camera });
  }, [camera]);
  useEffect(
    () => () => {
      if (useProfile.getState().entity?.kind === "webcam") profile.close();
    },
    [],
  );
  useEffect(() => setLive(false), [item?.key]);

  const step = (by: number): void => {
    sfx.click();
    onIndex((index + by + items.length) % items.length);
  };
  useHotkey((e) => e.key === "Escape", onClose, [onClose]);
  useHotkey((e) => e.key === "ArrowRight", () => step(1), [index, items.length]);
  useHotkey((e) => e.key === "ArrowLeft", () => step(-1), [index, items.length]);

  if (!item) return null;
  return (
    <motion.div className="webcams-focus" data-profiled={profiled || undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
      <button type="button" className="webcams-focus__scrim" aria-label="Close the large view" onClick={onClose} />
      <motion.section ref={panel} tabIndex={-1} className="webcams-focus__panel v-panel v-panel--solid" role="dialog" aria-modal="true" aria-label={item.title} initial={{ y: 14, scale: 0.985 }} animate={{ y: 0, scale: 1 }} transition={{ type: "spring", duration: 0.45, bounce: 0 }}>
        <header className="webcams-focus__head">
          <div className="webcams-focus__titles">
            <div className="v-eyebrow v-eyebrow--sodium">{item.eyebrow}</div>
            <h2 className="webcams-focus__title">{item.title}</h2>
            <div className="webcams-focus__subtitle">{item.subtitle}</div>
          </div>
          <div className="webcams-focus__nav">
            {items.length > 1 && (
              <>
                <IconButton label="Previous camera" onClick={() => step(-1)}>
                  <ChevronLeft size={16} />
                </IconButton>
                <span className="webcams-focus__count num">
                  {index + 1} / {items.length}
                </span>
                <IconButton label="Next camera" onClick={() => step(1)}>
                  <ChevronRight size={16} />
                </IconButton>
              </>
            )}
            <IconButton label="Close the large view" onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
        </header>
        <div className="webcams-focus__media" data-square={item.square || undefined}>
          <motion.div key={item.key} className="webcams-focus__feed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
            <Feed src={item.src} refreshS={item.refreshS} {...(item.frames ? { frames: item.frames } : {})} stream={item.stream ?? null} alt={item.title} onLive={setLive} />
          </motion.div>
          {live && (
            <span className="webcams-tile__rec webcams-focus__rec num">
              <i aria-hidden /> REC
            </span>
          )}
          {item.note && <span className="webcams-tile__note">{item.note}</span>}
        </div>
        <div className="webcams-focus__body">
          <Readout rows={item.rows} />
          {item.about && <p className="webcams-focus__about">{item.about}</p>}
          <p className="webcams-focus__license">
            {item.license}
            {camera?.page && (
              <>
                {" · "}
                <a href={camera.page} target="_blank" rel="noreferrer">
                  Open on {siteOf(camera.page)}
                </a>
              </>
            )}
          </p>
        </div>
      </motion.section>
    </motion.div>
  );
}
