import { motion } from "motion/react";
import { X } from "lucide-react";
import { useContext, useEffect, type ReactElement, type ReactNode } from "react";
import { ProfilerSectionsContext } from "../core/profile";
import { sfx } from "../core/sound";
import { Scramble } from "./Scramble";
import { InSheetContext } from "./Sheet";
import { IconButton, Scanning, type MaybeRow, type Row, type Tone } from "./primitives";

export interface ProfilerCardProps {
  /** What kind of thing this is, shown in the coloured band: "Aircraft", "Structure", "Device on your network". */
  band: string;
  name: string;
  kicker?: string;
  tone?: Tone;
  media?: string | null;
  rows: MaybeRow[];
  /** One sentence worth knowing — the Profiler's "fun fact". */
  fact?: ReactNode;
  actions?: ReactNode;
  /** Data attribution, e.g. "ADS-B via adsb.lol · ODbL". */
  source?: string;
  /** Custom content between the rows and the note, e.g. a departures board. Sections from other plugins follow it. */
  children?: ReactNode;
  loading?: boolean;
  onClose?: () => void;
}

/**
 * The Profiler: the one card every module uses to describe the thing you selected.
 * It locks on with a sound, scans once, and decrypts its text into place.
 * Give it a `key` that changes with the target so each new target re-runs the reveal.
 */
export function ProfilerCard({ band, name, kicker, tone = "ice", media, rows, fact, actions, source, loading, onClose, children }: ProfilerCardProps): ReactElement {
  useEffect(() => {
    sfx.lock();
  }, []);

  const sections = useContext(ProfilerSectionsContext);
  const inSheet = useContext(InSheetContext);
  const visibleRows = rows.filter((r): r is Row => Boolean(r));

  return (
    <motion.article
      className={`v-profiler v-profiler--${tone}`}
      // In a bottom sheet the sheet itself slides; the card only fades, so a phone animates opacity alone.
      initial={inSheet ? { opacity: 0 } : { opacity: 0, x: 14, filter: "blur(6px)" }}
      animate={inSheet ? { opacity: 1 } : { opacity: 1, x: 0, filter: "blur(0px)" }}
      exit={inSheet ? { opacity: 0, transition: { duration: 0.12 } } : { opacity: 0, x: 8, filter: "blur(4px)", transition: { duration: 0.14 } }}
      transition={{ type: "spring", duration: 0.42, bounce: 0 }}
      aria-label={`${band}: ${name}`}
    >
      <div className="v-profiler__scan" aria-hidden />
      <div className="v-profiler__band">
        <span>
          <Scramble text={band} duration={300} />
        </span>
        {onClose && (
          <IconButton label="Close profile" onClick={onClose}>
            <X size={14} strokeWidth={2} />
          </IconButton>
        )}
      </div>
      <div className="v-profiler__top">
        {media && <img className="v-profiler__media" src={media} alt="" loading="lazy" />}
        <div style={{ minWidth: 0 }}>
          <h3 className="v-profiler__name">
            <Scramble text={name} duration={560} delay={80} />
          </h3>
          {kicker && (
            <div className="v-profiler__kicker">
              <Scramble text={kicker} duration={420} delay={180} />
            </div>
          )}
        </div>
      </div>
      {visibleRows.length > 0 && (
        <dl className="v-readout v-profiler__rows">
          {visibleRows.map(([k, v], i) => (
            <motion.div
              key={i}
              style={{ display: "contents" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.18 + i * 0.045, duration: 0.2 }}
            >
              <dt>{k}</dt>
              <dd>{typeof v === "string" ? <Scramble text={v} duration={380} delay={200 + i * 45} /> : v}</dd>
            </motion.div>
          ))}
        </dl>
      )}
      {(children || sections) && (
        <div className="v-profiler__custom">
          {children}
          {sections}
        </div>
      )}
      {loading && (
        <div style={{ padding: "0 16px 16px" }}>
          <Scanning label="Profiling" />
        </div>
      )}
      {fact && (
        <motion.p className="v-profiler__fact" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4, duration: 0.3 }}>
          {fact}
        </motion.p>
      )}
      {actions && <div className="v-profiler__actions">{actions}</div>}
      {source && <div className="v-profiler__source">{source}</div>}
    </motion.article>
  );
}
