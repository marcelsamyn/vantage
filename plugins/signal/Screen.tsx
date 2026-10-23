import { Pause, Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { feed } from "../../app/core/feed";
import { useAnimationFrame, useStoredState } from "../../app/core/hooks";
import { useIntent } from "../../app/core/nav";
import { Button, LiveDot, Page, Panel, Segmented } from "../../app/ui";
import { bandShape, detectPitch, findTones, FLOOR_DB, measureLevel, noteFor, strongestTone } from "./analysis";
import { BAND_FROM_HZ, BAND_TO_HZ, BeaconPanel } from "./BeaconPanel";
import { BeaconTracker, CONFIRM_MS } from "./tracker";
import { LevelPanel } from "./Level";
import { Prompt } from "./Prompt";
import { useSignalSource, type SourceKind } from "./source";
import { Spectrogram, type SpectrogramHandle } from "./Spectrogram";
import { TunerPanel } from "./Tuner";
import type { PanelId, Snapshot } from "./types";
import "./signal.css";

const SOURCES = [
  { value: "mic", label: "Microphone" },
  { value: "file", label: "File" },
] as const satisfies readonly { value: SourceKind; label: string }[];

/** Readings are published this often; the spectrogram itself draws every frame. */
const TICK_MS = 80;
const HISTORY_EVERY_MS = 250;
const HISTORY_LENGTH = 120;
const PEAK_HOLD_MS = 1500;
const PITCH_MEMORY_MS = 500;
const BAND_COLUMNS = 96;

interface Engine {
  spectrum: Float32Array<ArrayBuffer>;
  wave: Float32Array<ArrayBuffer>;
  lastTick: number;
  lastHistory: number;
  rmsDb: number;
  hold: { db: number; at: number };
  history: number[];
  pitches: number[];
  lastPitchAt: number;
  tracker: BeaconTracker;
}

function newEngine(): Engine {
  return {
    spectrum: new Float32Array(0),
    wave: new Float32Array(0),
    lastTick: 0,
    lastHistory: 0,
    rmsDb: FLOOR_DB,
    hold: { db: FLOOR_DB, at: 0 },
    history: [],
    pitches: [],
    lastPitchAt: 0,
    tracker: new BeaconTracker(),
  };
}

const median = (values: number[]): number => [...values].sort((a, b) => a - b)[values.length >> 1] ?? 0;

export default function SignalScreen(): ReactElement {
  const source = useSignalSource();
  const { state } = source;
  const [offset, setOffset] = useStoredState("signal.splOffset", 120);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [flash, setFlash] = useState<PanelId | null>(null);
  const plot = useRef<SpectrogramHandle>(null);
  const engine = useRef<Engine>(newEngine());
  const fileInput = useRef<HTMLInputElement>(null);
  const panels = useRef<Record<PanelId, HTMLDivElement | null>>({ level: null, tuner: null, beacons: null });

  useIntent("signal", ({ action }) => {
    if (action !== "level" && action !== "tuner" && action !== "beacons") return;
    panels.current[action]?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(action);
  });
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 2000);
    return () => clearTimeout(id);
  }, [flash]);

  const analyser = state.analyser;
  // A new source starts from a blank plot and clean readings, but keeps the detection log.
  useEffect(() => {
    plot.current?.reset();
    const e = engine.current;
    Object.assign(e, { lastTick: 0, rmsDb: FLOOR_DB, hold: { db: FLOOR_DB, at: 0 }, history: [], pitches: [], lastPitchAt: 0 });
    if (!analyser) setSnap(null);
  }, [analyser]);

  useAnimationFrame((dt, now) => {
    if (!analyser) return;
    const e = engine.current;
    if (e.spectrum.length !== analyser.frequencyBinCount) {
      e.spectrum = new Float32Array(analyser.frequencyBinCount);
      e.wave = new Float32Array(analyser.fftSize);
    }
    const sampleRate = analyser.context.sampleRate;
    const binHz = sampleRate / analyser.fftSize;
    analyser.getFloatFrequencyData(e.spectrum);
    plot.current?.push(e.spectrum, binHz, dt);

    if (now - e.lastTick < TICK_MS) return;
    const elapsed = e.lastTick === 0 ? TICK_MS / 1000 : (now - e.lastTick) / 1000;
    e.lastTick = now;
    analyser.getFloatTimeDomainData(e.wave);

    // Level: 125 ms RMS window with a smoothed read-out and a peak marker that holds, then falls.
    const level = measureLevel(e.wave, Math.round(sampleRate * 0.125));
    e.rmsDb += (level.rmsDb - e.rmsDb) * 0.5;
    if (level.peakDb >= e.hold.db || now - e.hold.at > PEAK_HOLD_MS) {
      if (level.peakDb >= e.hold.db) e.hold = { db: level.peakDb, at: now };
      else e.hold.db = Math.max(level.peakDb, e.hold.db - 20 * elapsed);
    }
    if (now - e.lastHistory >= HISTORY_EVERY_MS) {
      e.lastHistory = now;
      e.history = [...e.history, e.rmsDb].slice(-HISTORY_LENGTH);
    }

    // Pitch: median of the last few readings so one noisy frame does not move the needle.
    const pitch = detectPitch(e.wave, sampleRate);
    if (pitch) {
      e.pitches = [...e.pitches, pitch.frequency].slice(-5);
      e.lastPitchAt = now;
    } else if (now - e.lastPitchAt > PITCH_MEMORY_MS) e.pitches = [];
    const steady = e.pitches.length > 0 ? median(e.pitches) : null;

    // Beacon band: only as far as this source's sample rate reaches.
    const reachHz = Math.min(BAND_TO_HZ, sampleRate / 2 - binHz * 24);
    const inReach = reachHz > BAND_FROM_HZ + 500;
    const tones = inReach ? findTones(e.spectrum, binHz, BAND_FROM_HZ, reachHz) : [];
    for (const beacon of e.tracker.update(now, tones)) {
      feed(
        {
          level: "alert",
          source: "signal",
          title: "Possible ultrasonic beacon",
          detail: `A ${(beacon.frequency / 1000).toFixed(2)} kHz tone held for ${(CONFIRM_MS / 1000).toFixed(1)} s or more. Many apps and ads use tones like this to link devices.`,
          go: { screen: "signal", action: "beacons" },
        },
        { key: `signal:beacon:${Math.round(beacon.frequency / 200)}`, dedupeMs: 60_000, toast: true },
      );
    }
    const loudest = inReach ? strongestTone(e.spectrum, binHz, BAND_FROM_HZ, reachHz) : null;
    const top = tones[0];

    setSnap({
      sampleRate,
      rmsDb: e.rmsDb,
      peakHoldDb: e.hold.db,
      history: e.history,
      pitch: steady === null ? null : { frequency: steady, note: noteFor(steady) },
      strongest: strongestTone(e.spectrum, binHz, 20, 20_000),
      band: {
        shape: inReach ? bandShape(e.spectrum, binHz, BAND_FROM_HZ, reachHz, BAND_COLUMNS) : [],
        reachHz: inReach ? reachHz : 0,
        peakDb: loudest?.db ?? FLOOR_DB,
        peakHz: loudest?.frequency ?? null,
        prominence: top?.prominence ?? 0,
        toneNow: top !== undefined,
      },
      beaconActive: e.tracker.active,
      beacons: e.tracker.log(),
    });
    // Live analysis: it keeps listening for beacons whether or not anyone touches the page.
  }, analyser !== null, "data");

  const clearBeacons = useCallback((): void => {
    engine.current.tracker.clear();
    setSnap((s) => (s ? { ...s, beacons: [], beaconActive: false } : s));
  }, []);

  const live = state.status === "live";
  const label = state.label ?? (state.kind === "mic" ? "Microphone" : "File");

  return (
    <Page
      eyebrow="Signal"
      title="Signal"
      lede="See the sound around you: a live spectrogram, loudness, pitch and a watch for ultrasonic beacons. Everything is analysed inside this browser."
      actions={<Segmented label="Audio source" value={state.kind} options={SOURCES} onChange={source.select} />}
    >
      <div className="signal-stack">
        <Panel title="Spectrogram" flush>
          <Spectrogram ref={plot}>
            <Prompt state={state} onMic={() => void source.startMic()} onChooseFile={() => fileInput.current?.click()} />
          </Spectrogram>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*"
            className="sr-only"
            aria-label="Audio file to analyse"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = "";
              if (file) source.openFile(file);
            }}
          />
          {live && (
            <div className="signal-controls">
              <span className="signal-status num">
                <LiveDot tone={state.kind === "mic" ? "ice" : "sodium"} />
                {label}
                {snap && <span className="faint"> · {(snap.sampleRate / 1000).toFixed(1)} kHz</span>}
              </span>
              {state.kind === "file" && (
                <>
                  <Button size="sm" icon={source.filePlaying ? <Pause size={13} /> : <Play size={13} />} onClick={source.toggleFile}>
                    {source.filePlaying ? "Pause" : "Play"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
                    Choose another file
                  </Button>
                  {state.message && <span className="alarm signal-hint">{state.message}</span>}
                </>
              )}
              {state.kind === "mic" && (
                <Button size="sm" icon={<Square size={12} />} onClick={source.stop}>
                  Stop listening
                </Button>
              )}
            </div>
          )}
        </Panel>

        <div className="signal-grid">
          <div ref={(el) => void (panels.current.level = el)} className="signal-slot">
            <LevelPanel snap={snap} source={state.kind} offset={offset} onOffset={setOffset} active={flash === "level"} />
          </div>
          <div ref={(el) => void (panels.current.tuner = el)} className="signal-slot">
            <TunerPanel snap={snap} active={flash === "tuner"} />
          </div>
          <div ref={(el) => void (panels.current.beacons = el)} className="signal-slot signal-grid__wide">
            <BeaconPanel snap={snap} onClear={clearBeacons} active={flash === "beacons"} />
          </div>
        </div>
      </div>
    </Page>
  );
}
