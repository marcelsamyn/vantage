import { motion } from "motion/react";
import type { CSSProperties, ReactElement } from "react";
import { Panel, Readout } from "../../app/ui";
import type { Snapshot } from "./types";

const DEGREES_PER_CENT = 0.9;
const CX = 130;
const CY = 128;
const RADIUS = 112;
const IN_TUNE_CENTS = 5;

const TICKS = Array.from({ length: 11 }, (_, i) => (i - 5) * 10);

function point(cents: number, radius: number): { x: number; y: number } {
  const angle = (cents * DEGREES_PER_CENT * Math.PI) / 180;
  return { x: CX + Math.sin(angle) * radius, y: CY - Math.cos(angle) * radius };
}

export function TunerPanel({ snap, active }: { snap: Snapshot | null; active: boolean }): ReactElement {
  const pitch = snap?.pitch ?? null;
  const cents = pitch ? Math.max(-50, Math.min(50, pitch.note.cents)) : 0;
  const inTune = pitch !== null && Math.abs(pitch.note.cents) <= IN_TUNE_CENTS;
  const tone = inTune ? "var(--mint)" : "var(--ice)";

  return (
    <Panel title="Tuner" active={active}>
      <div className="signal-tuner" style={{ "--tone": tone } as CSSProperties}>
        <svg className="signal-gauge" viewBox="0 0 260 150" role="img" aria-label={pitch ? `${pitch.note.name}${pitch.note.octave}, ${pitch.note.cents} cents` : "No pitch detected"}>
          {TICKS.map((c) => {
            const major = c % 50 === 0;
            const a = point(c, RADIUS);
            const b = point(c, RADIUS - (major ? 18 : 10));
            return <line key={c} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="signal-gauge__tick" data-major={major} data-centre={c === 0} />;
          })}
          <text x={point(-50, RADIUS + 2).x - 2} y={CY + 16} className="signal-gauge__label" textAnchor="middle">
            ♭
          </text>
          <text x={point(50, RADIUS + 2).x + 2} y={CY + 16} className="signal-gauge__label" textAnchor="middle">
            ♯
          </text>
          <motion.g
            style={{ transformOrigin: `${CX}px ${CY}px` }}
            initial={false}
            animate={{ rotate: cents * DEGREES_PER_CENT, opacity: pitch ? 1 : 0.25 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            <line x1={CX} y1={CY} x2={CX} y2={CY - RADIUS + 6} className="signal-gauge__needle" />
            <circle cx={CX} cy={CY} r={5} className="signal-gauge__hub" />
          </motion.g>
        </svg>

        <div className="signal-note-name display" data-idle={pitch === null}>
          {pitch ? (
            <>
              {pitch.note.name}
              <sub>{pitch.note.octave}</sub>
            </>
          ) : (
            "—"
          )}
        </div>
        <div className="signal-tuner__state">{pitch ? (inTune ? "In tune" : `${pitch.note.cents > 0 ? "+" : "−"}${Math.abs(pitch.note.cents)} cents ${pitch.note.cents > 0 ? "sharp" : "flat"}`) : snap ? "Play one note" : "Waiting for sound"}</div>

        <Readout
          rows={[
            ["Frequency", pitch ? `${pitch.frequency.toFixed(1)} Hz` : "—"],
            ["Target", pitch ? `${pitch.note.target.toFixed(1)} Hz` : "—"],
            ["Strongest tone", snap?.strongest ? `${snap.strongest.frequency.toFixed(snap.strongest.frequency < 1000 ? 1 : 0)} Hz` : "—"],
          ]}
        />
        <p className="signal-note dim">Pitch is measured from the waveform for notes between 30 Hz and 1.6 kHz, with A4 = 440 Hz. Play a single note, and keep other sounds quiet.</p>
      </div>
    </Panel>
  );
}
