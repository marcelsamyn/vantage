import { useCallback, useEffect, useMemo, useReducer, useRef, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Empty, LiveDot, ProfilerCard, Scanning, type Tone } from "../../app/ui";
import { useSignalDetail, useSignalStream } from "./client";
import { LANE_LABEL, laneWords, lookOf } from "./signals";
import type { SignalDetail, SignalStream, SignalStreamEvent } from "./types";
import "./pulse.css";

const WINDOW_MS = 120_000;

interface Reading {
  v: number | boolean;
  at: number;
}

interface Live {
  readings: Map<number, Reading>;
  /** State changes of the primary head, oldest first. */
  phases: { v: number; at: number }[];
}

type Action = { type: "seed"; detail: SignalDetail } | { type: "event"; primary: number; event: SignalStreamEvent };

function reduce(live: Live, action: Action): Live {
  if (action.type === "seed") {
    const readings = new Map<number, Reading>();
    for (const s of action.detail.streams) if (s.value !== null && s.at !== null) readings.set(s.id, { v: s.value, at: s.at });
    return { readings, phases: action.detail.history };
  }
  const e = action.event;
  if (e.t !== "state") return live;
  const prev = live.readings.get(e.id);
  if (prev && e.at < prev.at) return live;
  const readings = new Map(live.readings).set(e.id, { v: e.v, at: e.at });
  let phases = live.phases;
  const last = phases[phases.length - 1];
  if (e.id === action.primary && typeof e.v === "number" && last?.v !== e.v) phases = [...phases, { v: e.v, at: e.at }];
  return { readings, phases };
}

function toneOf(code: number | undefined): Tone {
  if (code === 1) return "alarm";
  if (code === 2 || code === 4 || code === 5) return "sodium";
  if (code === 3 || code === 6) return "mint";
  return "ice";
}

export default function SignalProfile({ entity, onClose }: ProfilerProps<"signalhead">): ReactElement {
  const head = entity.data.head;
  const { data: detail, error, loading } = useSignalDetail(head.thing);
  const [live, dispatch] = useReducer(reduce, { readings: new Map(), phases: [] });
  const primary = detail?.primary ?? head.id;
  const seeded = useRef<number | null>(null);

  useEffect(() => {
    if (detail && seeded.current !== detail.thing) {
      seeded.current = detail.thing;
      dispatch({ type: "seed", detail });
    }
  }, [detail]);

  // Cycle-time and programme streams change every second or hardly ever; only the ones that tell a story are followed.
  const ids = useMemo(() => (detail ? detail.streams.filter((s) => s.kind !== "program").map((s) => s.id) : []), [detail]);
  const onEvent = useCallback((event: SignalStreamEvent) => dispatch({ type: "event", primary, event }), [primary]);
  const stream = useSignalStream(ids, true, onEvent);

  const current = live.readings.get(primary);
  const code = typeof current?.v === "number" ? current.v : undefined;
  const look = lookOf(code);
  const now = useNow(250);

  return (
    <ProfilerCard
      band="Traffic light · live"
      tone={toneOf(code)}
      name={`Junction ${head.junction}`}
      kicker={`Lane ${head.name} · for ${laneWords(detail?.laneType ?? LANE_LABEL[head.lane].toLowerCase())}`}
      onClose={onClose}
      loading={loading && !detail}
      rows={[
        head.group && ["Signal group", head.group],
        detail?.ingressLane && detail.egressLane && ["Lane connection", `lane ${detail.ingressLane} to lane ${detail.egressLane}`],
        ["Position", fmt.coord(head.lat, head.lon)],
      ]}
      fact="Hamburg's traffic-light controllers publish every change of every signal head as open data, within about a second."
      source={`${stream.state === "live" ? (stream.transport === "mqtt" ? "Live over MQTT" : "Live, checked every 2 s") : "Connecting"} · Freie und Hansestadt Hamburg · Datenlizenz Deutschland 2.0`}
    >
      {error && !detail ? (
        <Empty title="Could not read this light" tone="error">
          {error.message}
        </Empty>
      ) : !detail ? (
        <Scanning label="Reading the controller" />
      ) : (
        <div className="pulse-signal">
          <div className="pulse-signal__hero" aria-live="polite">
            <span className="pulse-signal__lamp" style={{ background: look.css, boxShadow: code === 0 || code === undefined ? "none" : `0 0 18px ${look.css}` }} />
            <div>
              <div className="pulse-signal__state display" style={{ color: look.css }}>
                {current ? look.label : "Waiting"}
              </div>
              <div className="pulse-signal__held num">{current ? `${held(now - current.at)}` : "No reading yet"}</div>
            </div>
            <LiveDot tone={stream.state === "live" ? "mint" : "sodium"} live={stream.state === "live"} />
          </div>
          <PhaseStrip phases={live.phases} now={now} />
          <Sensors detail={detail} readings={live.readings} now={now} />
        </div>
      )}
    </ProfilerCard>
  );
}

function held(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `for ${s} s`;
  return `for ${fmt.duration(s)}`;
}

// ── Last two minutes ──────────────────────────────────────────────

function PhaseStrip({ phases, now }: { phases: { v: number; at: number }[]; now: number }): ReactElement {
  const from = now - WINDOW_MS;
  const segments = phases
    .map((p, i) => ({ v: p.v, start: Math.max(p.at, from), end: Math.min(phases[i + 1]?.at ?? now, now) }))
    .filter((s) => s.end > from && s.end > s.start);
  return (
    <figure className="pulse-strip">
      <div className="pulse-strip__bar" role="img" aria-label="Signal phases over the last two minutes">
        {segments.map((s) => (
          <span
            key={`${s.start}-${s.v}`}
            className="pulse-strip__seg"
            style={{ left: `${((s.start - from) / WINDOW_MS) * 100}%`, width: `${((s.end - s.start) / WINDOW_MS) * 100}%`, background: lookOf(s.v).css }}
            title={`${lookOf(s.v).label} for ${Math.round((s.end - s.start) / 1000)} s`}
          />
        ))}
      </div>
      <figcaption className="pulse-strip__axis num">
        <span>2 min ago</span>
        <span>1 min</span>
        <span>now</span>
      </figcaption>
    </figure>
  );
}

// ── Sensors ───────────────────────────────────────────────────────

/** "Signal change request - car at 91_15_1" → "sensor 1". */
function sensorNumber(name: string): string | null {
  const tail = name.split(" at ")[1];
  const n = tail?.split("_")[2];
  return n ?? null;
}

interface Explained {
  title: string;
  value: string;
  note: string;
  active: boolean;
}

function explain(stream: SignalStream, reading: Reading | undefined, now: number): Explained | null {
  const n = sensorNumber(stream.name);
  const tag = n ? ` ${n}` : "";
  const v = reading?.v;
  const seen = reading ? `last change ${fmt.ago(reading.at, now)}` : "no reading yet";
  switch (stream.kind) {
    case "car": {
      const pct = typeof v === "number" ? v : null;
      return {
        title: `Vehicle loop${tag}`,
        value: pct === null ? "no reading" : `${fmt.int(pct)}% covered`,
        note: `A loop in the road asks for green when cars wait on it. The percentage is how much of the last interval a vehicle sat on it; ${seen}.`,
        active: (pct ?? 0) > 0,
      };
    }
    case "cycle":
      return { title: `Bicycle request${tag}`, value: v === true ? "someone is waiting" : v === false ? "nobody waiting" : "no reading", note: `A detector at the stop line notices a bicycle and asks for green; ${seen}.`, active: v === true };
    case "pedestrian":
      return { title: `Crossing button${tag}`, value: v === true ? "pressed" : v === false ? "not pressed" : "no reading", note: `A pedestrian pressed the button or stands at the kerb; ${seen}.`, active: v === true };
    case "acoustic-request":
      return { title: `Audible signal button${tag}`, value: v === true ? "pressed" : v === false ? "not pressed" : "no reading", note: `People who cannot see the lights press it to hear when it is safe to cross; ${seen}.`, active: v === true };
    case "acoustic":
      return { title: "Beeper for blind pedestrians", value: v === 3 ? "sounding" : v === 0 ? "silent" : "no reading", note: "It sounds while the pedestrian light is green.", active: v === 3 };
    case "secondary":
      return { title: "Second signal head", value: typeof v === "number" ? lookOf(v).label : "no reading", note: "Some approaches show the same signal on a second head, for example on the far side of the junction.", active: false };
    case "bus-pre":
    case "bus-request":
    case "bus-checkout": {
      const label = stream.kind === "bus-pre" ? "Bus announced" : stream.kind === "bus-request" ? "Bus asks for green" : "Bus has passed";
      const cancelled = v === 888 || v === 999;
      return {
        title: `${label}${tag}`,
        value: typeof v === "number" ? (cancelled ? "cancelled" : `line ${v}`) : "none yet",
        note:
          stream.kind === "bus-pre"
            ? `A bus sends its line number when it is still some way off, so the controller can plan for it; ${seen}.`
            : stream.kind === "bus-request"
              ? `The bus is close and asks for priority; ${seen}.`
              : `The bus has cleared the junction and priority ends; ${seen}.`,
        active: typeof v === "number" && !cancelled && reading !== undefined && now - reading.at < 60_000,
      };
    }
    case "primary":
    case "program":
      return null;
  }
}

function Sensors({ detail, readings, now }: { detail: SignalDetail; readings: Map<number, Reading>; now: number }): ReactElement | null {
  const items = detail.streams.map((s) => ({ stream: s, e: explain(s, readings.get(s.id), now) })).filter((x): x is { stream: SignalStream; e: Explained } => x.e !== null);
  if (items.length === 0) {
    return <p className="pulse-note">This lane connection has no sensors in the public data.</p>;
  }
  return (
    <div className="pulse-sensors">
      <div className="v-eyebrow">Sensors on this approach</div>
      <ul className="pulse-sensors__list">
        {items.map(({ stream, e }) => (
          <li key={stream.id} className="pulse-sensor" data-active={e.active}>
            <span className="pulse-sensor__title">{e.title}</span>
            <span className="pulse-sensor__value num">{e.value}</span>
            <span className="pulse-sensor__note">{e.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
