import { Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { Button, Empty, LiveDot, Panel, Sparkline, Stat, Tag } from "../../app/ui";
import { thresholds, useSentry } from "./store";
import type { Zone } from "./types";

const MAX_LEVEL = 20;

/** Shown over the picture whenever the sentry is armed, in every mode. */
export function RecBadge(): ReactElement | null {
  const armed = useSentry((s) => s.armed);
  const armedAt = useSentry((s) => s.armedAt);
  const lastEvent = useSentry((s) => s.lastEvent);
  const now = useNow(1000);
  if (!armed || armedAt === null) return null;
  return (
    <>
      <div className="scan-rec" role="status">
        <LiveDot tone="alarm" />
        <span className="scan-rec__label">REC</span>
        <span className="scan-rec__time num">{fmt.duration((now - armedAt) / 1000)}</span>
        <span className="scan-rec__note">Sentry armed</span>
      </div>
      {lastEvent && Date.now() - lastEvent.at < 1500 && <div key={lastEvent.id} className="scan-flash" aria-hidden />}
    </>
  );
}

/** Drag on the picture to watch only part of it. A plain click clears the zone. */
export function ZoneLayer(): ReactElement {
  const zone = useSentry((s) => s.zone);
  const setZone = useSentry((s) => s.setZone);
  const [draft, setDraft] = useState<Zone | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const point = (e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)), y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)) };
  };
  const rectOf = (a: { x: number; y: number }, b: { x: number; y: number }): Zone => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

  const shown = draft ?? zone;
  return (
    <div
      className="scan-zone"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = point(e);
      }}
      onPointerMove={(e) => {
        if (origin.current) setDraft(rectOf(origin.current, point(e)));
      }}
      onPointerUp={(e) => {
        const start = origin.current;
        origin.current = null;
        setDraft(null);
        if (!start) return;
        const next = rectOf(start, point(e));
        setZone(next.w > 0.04 && next.h > 0.04 ? next : null);
      }}
    >
      {shown ? (
        <div className="scan-zone__rect" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.w * 100}%`, height: `${shown.h * 100}%` }}>
          <span className="scan-zone__label">Watched zone</span>
        </div>
      ) : (
        <span className="scan-zone__hint">Whole picture watched. Drag to choose a zone.</span>
      )}
    </div>
  );
}

function LevelBar({ percent, limit }: { percent: number; limit: number }): ReactElement {
  const over = percent >= limit;
  return (
    <div className="scan-level" role="meter" aria-label="Motion level" aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={MAX_LEVEL}>
      <div className={`scan-level__fill${over ? " scan-level__fill--over" : ""}`} style={{ width: `${Math.min(100, (percent / MAX_LEVEL) * 100)}%` }} />
      <div className="scan-level__limit" style={{ left: `${(limit / MAX_LEVEL) * 100}%` }} />
    </div>
  );
}

export function SentryPanel({ canArm, reason }: { canArm: boolean; reason: string | null }): ReactElement {
  const armed = useSentry((s) => s.armed);
  const sensitivity = useSentry((s) => s.sensitivity);
  const zone = useSentry((s) => s.zone);
  const level = useSentry((s) => s.level);
  const history = useSentry((s) => s.history);
  const events = useSentry((s) => s.events);
  const { arm, disarm, setSensitivity, setZone, clearEvents } = useSentry.getState();
  const limit = thresholds(sensitivity).area;

  return (
    <>
      <Panel title="Motion sentry" active={armed} actions={<Tag tone={armed ? "alarm" : undefined}>{armed ? "Armed" : "Disarmed"}</Tag>}>
        <div className="scan-sentry">
          <div className="scan-actions">
            {armed ? (
              <Button variant="danger" onClick={disarm}>
                Disarm sentry
              </Button>
            ) : (
              <Button variant="primary" disabled={!canArm} onClick={arm}>
                Arm sentry
              </Button>
            )}
          </div>
          {!canArm && !armed && <p className="scan-note">{reason}</p>}
          <p className="scan-note">Sentry runs only while the Scan screen is open. Leave this screen and it disarms. Nothing is saved to disk: the event log below lives in memory.</p>

          <div className="scan-sentry__level">
            <Stat label="Motion now" value={level.toFixed(1)} unit="%" size="sm" tone={armed && level >= limit ? "alarm" : undefined} />
            <div className="scan-sentry__graph">
              <Sparkline values={history.length > 1 ? history : [0, 0]} max={MAX_LEVEL} tone={armed && level >= limit ? "alarm" : "ice"} height={36} />
            </div>
          </div>
          <LevelBar percent={level} limit={limit} />

          <label className="scan-slider">
            <span className="v-eyebrow">Sensitivity</span>
            <input type="range" min={1} max={10} step={1} value={sensitivity} onChange={(e) => setSensitivity(Number(e.target.value))} aria-label="Sensitivity" />
            <span className="num scan-slider__value">{sensitivity}/10</span>
          </label>
          <p className="scan-note">Triggers when more than {limit.toFixed(1)}% of the {zone ? "zone" : "picture"} changes. Raise sensitivity for small movements, lower it if light flicker sets it off.</p>
          {zone && (
            <div className="scan-actions">
              <Button size="sm" variant="ghost" onClick={() => setZone(null)}>
                Clear zone
              </Button>
            </div>
          )}
        </div>
      </Panel>

      <Panel
        title={`Event log · ${events.length}`}
        actions={
          events.length > 0 ? (
            <Button size="sm" variant="ghost" icon={<Trash2 size={12} />} onClick={clearEvents}>
              Clear
            </Button>
          ) : undefined
        }
        flush
      >
        {events.length === 0 ? (
          <Empty title="No motion yet">Arm the sentry. Each detection appears here with a small picture.</Empty>
        ) : (
          <ul className="scan-events">
            <AnimatePresence initial={false}>
              {events.map((event) => (
                <motion.li
                  key={event.id}
                  className="scan-event"
                  layout="position"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ type: "spring", duration: 0.35, bounce: 0 }}
                >
                  <img className="scan-event__thumb" src={event.thumb} alt="" />
                  <div className="scan-event__main">
                    <div className="scan-event__time num">{fmt.clock(event.at, true)}</div>
                    <div className="scan-event__sub">
                      {fmt.one(event.amount)}% changed · {event.source}
                    </div>
                  </div>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </Panel>
    </>
  );
}
