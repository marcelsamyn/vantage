import type { CSSProperties, ReactElement } from "react";
import { Panel, Readout, Sparkline, Stat, Tag } from "../../app/ui";
import { FLOOR_DB } from "./analysis";
import type { SourceKind } from "./source";
import type { Snapshot } from "./types";

const BAR_MIN = -90;
const CLIP_DB = -6;

const barPercent = (db: number): number => Math.min(100, Math.max(0, ((db - BAR_MIN) / -BAR_MIN) * 100));
const show = (db: number): string => (db <= FLOOR_DB + 1 ? "−∞" : db.toFixed(1).replace("-", "−"));

export function LevelPanel({ snap, source, offset, onOffset, active }: { snap: Snapshot | null; source: SourceKind; offset: number; onOffset: (v: number) => void; active: boolean }): ReactElement {
  const rms = snap?.rmsDb ?? FLOOR_DB;
  const hold = snap?.peakHoldDb ?? FLOOR_DB;
  const spl = rms + offset;

  return (
    <Panel title="Sound level" active={active} actions={<Tag>Uncalibrated</Tag>}>
      <div className="signal-level">
        <Stat label="Loudness" value={snap ? show(rms) : "—"} unit="dBFS" size="lg" tone={rms > CLIP_DB ? "alarm" : undefined} />

        <div className="signal-bar" role="meter" aria-label="Level in dBFS" aria-valuemin={BAR_MIN} aria-valuemax={0} aria-valuenow={Math.round(rms)}>
          <div className="signal-bar__fill" data-hot={rms > CLIP_DB} style={{ transform: `scaleX(${barPercent(rms) / 100})` }} />
          {snap && hold > BAR_MIN && <div className="signal-bar__peak" data-hot={hold > CLIP_DB} style={{ left: `${barPercent(hold)}%` }} />}
        </div>
        <div className="signal-bar__scale" aria-hidden>
          {[-90, -60, -30, 0].map((db) => (
            <span key={db}>{db === 0 ? "0" : `−${-db}`}</span>
          ))}
        </div>

        <Readout
          rows={[
            ["Peak hold", snap ? `${show(hold)} dBFS` : "—"],
            ["Approx. sound", source === "mic" ? (snap ? `≈ ${Math.max(0, spl).toFixed(0)} dB SPL` : "—") : "Needs the microphone"],
          ]}
        />

        {snap && <Sparkline values={snap.history} min={BAR_MIN} max={0} height={44} />}

        {source === "mic" && (
          <label className="signal-calibrate">
            <span className="v-eyebrow">Calibration offset</span>
            <input
              type="range"
              className="signal-range"
              min={80}
              max={140}
              step={1}
              value={offset}
              aria-label="Calibration offset in dB"
              style={{ "--fill": `${((offset - 80) / 60) * 100}%` } as CSSProperties}
              onChange={(e) => onOffset(e.currentTarget.valueAsNumber)}
            />
            <span className="num">+{offset} dB</span>
          </label>
        )}
        <p className="signal-note dim">
          {source === "mic"
            ? "dBFS is level inside the computer, 0 at the loudest it can go. dB SPL is air pressure, which depends on your microphone. This estimate is not calibrated: hold a sound meter app beside the Mac and move the slider until both agree."
            : "dBFS is level inside the computer, 0 at the loudest it can go. Sound pressure in dB SPL can only be estimated from a microphone."}
        </p>
      </div>
    </Panel>
  );
}
