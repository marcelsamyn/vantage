import { motion } from "motion/react";
import { Pause, Play, Search, SkipBack, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import { Button, IconButton, Input, Meter, Readout, Scanning, Segmented, Tag, Toggle } from "../../app/ui";
import { act, LOW_SUPPLY_PERCENT, pairDevice, useBusy, useControl } from "./client";
import { askConfirm } from "./Confirm";
import { Dial } from "./Dial";
import { KIND } from "./kinds";
import type { Capability, CapabilityOf, Device } from "./types";

/**
 * Controls drawn from capabilities alone. Any device, from any driver, renders through these components,
 * so a new device type needs no change here.
 */

const fill = (template: string, label: string): string => template.replaceAll("{label}", label);

/** Pick one option of a choice, after the confirmation the capability asks for. */
export async function choose(device: Device, c: CapabilityOf<"choice">, id: string): Promise<boolean> {
  const option = c.options.find((o) => o.id === id);
  if (!option || id === c.current) return false;
  if (c.confirm && !(await askConfirm({ title: option.label, body: fill(c.confirm.text, option.label), action: fill(c.confirm.action, option.label) }))) return false;
  return act<"choice">(device, c.id, id);
}

// ── Single capabilities ───────────────────────────────────────────

function SwitchControl({ device, c }: { device: Device; c: CapabilityOf<"switch"> }): ReactElement {
  const busy = useBusy(device.id, c.id);
  return <Toggle label={busy ? `${c.label}…` : c.label} checked={c.on} onChange={(on) => void act<"switch">(device, c.id, on)} />;
}

function LevelControl({ device, c }: { device: Device; c: CapabilityOf<"level"> }): ReactElement {
  return <Dial label={c.label} value={c.value} disabled={!device.online} onCommit={(v) => void act<"level">(device, c.id, v)} />;
}

function ColorControl({ device, c }: { device: Device; c: CapabilityOf<"color"> }): ReactElement {
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // React's onChange fires on every movement inside the picker. The native change event fires once, when the
  // picker closes, so the light changes once per choice.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const commit = (): void => void act<"color">(device, c.id, el.value).finally(() => setPreview(null));
    el.addEventListener("change", commit);
    return () => el.removeEventListener("change", commit);
  }, [device, c.id]);
  const hex = preview ?? c.hex;
  return (
    <label className="control-color">
      <span className="control-color__swatch" style={{ background: hex }} />
      <span className="num">{hex.toUpperCase()}</span>
      <span className="dim">Change</span>
      <input ref={input} type="color" className="sr-only" value={hex} aria-label={`${c.label} of ${device.name}`} onChange={(e) => setPreview(e.target.value)} />
    </label>
  );
}

function ActionControl({ device, c }: { device: Device; c: CapabilityOf<"action"> }): ReactElement {
  const busy = useBusy(device.id, c.id);
  const [text, setText] = useState("");
  const run = async (): Promise<void> => {
    if (c.confirm && !(await askConfirm({ title: c.label, body: c.confirm.text, action: c.confirm.action }))) return;
    if (c.input) {
      if (await act<"action">(device, c.id, text)) setText("");
    } else await act<"action">(device, c.id, null);
  };

  if (!c.input) {
    return (
      <Button size="sm" onClick={() => void run()} disabled={busy}>
        {busy ? "Working…" : c.label}
      </Button>
    );
  }
  return (
    <form
      className="control-action"
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <Input value={text} maxLength={c.input.maxLength} placeholder={c.input.placeholder} aria-label={c.input.placeholder} onChange={(e) => setText(e.target.value)} />
      <Button size="sm" type="submit" disabled={busy || !text.trim()}>
        {busy ? "Working…" : c.label}
      </Button>
      <span className="control-action__count num">
        {text.length}/{c.input.maxLength}
      </span>
    </form>
  );
}

/** Few options: a segmented control. Many: a searchable grid, which is how Shortcuts and scenes show. */
export function ChoiceControl({ device, c, columns, initialQuery = "" }: { device: Device; c: CapabilityOf<"choice">; columns?: boolean; initialQuery?: string }): ReactElement {
  const busy = useBusy(device.id, c.id);
  const [query, setQuery] = useState(initialQuery);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? c.options.filter((o) => o.label.toLowerCase().includes(q)) : c.options;
  }, [c.options, query]);

  // Grid tiles are plain buttons, so they make the click sound the kit's buttons make.
  const pick = (id: string): void => {
    sfx.click();
    void choose(device, c, id);
  };

  if (c.options.length <= 4 && c.current !== null) {
    return <Segmented label={`${c.label} of ${device.name}`} value={c.current} options={c.options.map((o) => ({ value: o.id, label: o.label }))} onChange={(id) => void choose(device, c, id)} />;
  }
  if (!c.options.length) return <p className="dim">Nothing to choose from yet.</p>;
  return (
    <div className="control-choice">
      {c.options.length > 6 && <Input prompt={<Search size={13} />} value={query} placeholder={`Search ${c.options.length}`} aria-label={`Search ${c.label}`} onChange={(e) => setQuery(e.target.value)} />}
      <div className={`control-choice__grid${columns ? " control-choice__grid--wide" : ""}`} aria-busy={busy}>
        {shown.map((o, i) => (
          <motion.button
            key={o.id}
            type="button"
            className="control-choice__item"
            aria-pressed={o.id === c.current}
            disabled={busy}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i, 16) * 0.02, duration: 0.2 }}
            onClick={() => pick(o.id)}
          >
            {o.label}
          </motion.button>
        ))}
        {!shown.length && <p className="dim control-choice__none">Nothing matches “{query}”.</p>}
      </div>
    </div>
  );
}

export function MediaControl({ device, c, at }: { device: Device; c: CapabilityOf<"media">; at: number }): ReactElement {
  const busy = useBusy(device.id, c.id);
  const playing = c.state === "playing";
  const now = useNow(playing ? 1_000 : 60_000);
  const t = c.track;
  // The position was read at `at`; while playing it moves on with the clock.
  const position = t?.position != null ? Math.min(t.duration ?? Number.POSITIVE_INFINITY, t.position + (playing ? Math.max(0, now - at) / 1000 : 0)) : null;
  const send = (command: "playpause" | "next" | "previous"): void => void act<"media">(device, c.id, command);

  return (
    <div className="control-media">
      <div className="control-media__art">{t?.artwork ? <img src={t.artwork} alt="" /> : <KIND.player.icon size={22} strokeWidth={1.5} />}</div>
      <div className="control-media__main">
        <div className="control-media__title">{t ? t.title : "Stopped"}</div>
        <div className="control-media__sub">{t ? [t.artist, t.album].filter(Boolean).join(" · ") || device.name : `${device.name} is not playing anything.`}</div>
        {t?.duration != null && position != null && (
          <div className="control-media__time num">
            <Meter value={position} max={t.duration} />
            <span>
              {fmt.duration(position)} / {fmt.duration(t.duration)}
            </span>
          </div>
        )}
      </div>
      <div className="control-media__transport">
        <IconButton label="Previous track" onClick={() => send("previous")} disabled={busy || !t}>
          <SkipBack size={15} />
        </IconButton>
        <IconButton label={playing ? "Pause" : "Play"} on={playing} onClick={() => send("playpause")} disabled={busy}>
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </IconButton>
        <IconButton label="Next track" onClick={() => send("next")} disabled={busy || !t}>
          <SkipForward size={15} />
        </IconButton>
      </div>
    </div>
  );
}

export function SuppliesView({ c }: { c: CapabilityOf<"supplies"> }): ReactElement {
  return (
    <ul className="control-supplies">
      {c.supplies.map((s, i) => {
        const low = s.percent !== null && s.percent < LOW_SUPPLY_PERCENT;
        return (
          <li key={s.name + i} className="control-supply">
            <span className="control-supply__swatch" style={s.color ? { background: s.color } : undefined} aria-hidden />
            <span className="control-supply__name">
              {s.name} <span className="faint">{s.type}</span>
            </span>
            <span className={`num${low ? " alarm" : ""}`}>{s.percent === null ? "Unknown" : `${s.percent} %`}</span>
            <div className="control-supply__bar">
              <Meter value={s.percent ?? 0} max={100} tone={low ? "alarm" : "ice"} ticks />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function CapabilityView({ device, c, at }: { device: Device; c: Capability; at: number }): ReactElement {
  switch (c.kind) {
    case "switch":
      return <SwitchControl device={device} c={c} />;
    case "level":
      return <LevelControl device={device} c={c} />;
    case "color":
      return <ColorControl device={device} c={c} />;
    case "media":
      return <MediaControl device={device} c={c} at={at} />;
    case "choice":
      return <ChoiceControl device={device} c={c} />;
    case "action":
      return <ActionControl device={device} c={c} />;
    case "supplies":
      return <SuppliesView c={c} />;
    case "info":
      return <Readout rows={c.rows} />;
  }
}

// ── Device panel ──────────────────────────────────────────────────

export function PairBlock({ device }: { device: Device }): ReactElement | null {
  const busy = useBusy(device.id, "pair");
  if (!device.pairing || device.pairing.paired) return null;
  return (
    <div className="control-pair">
      <p>{device.pairing.prompt}</p>
      {busy ? (
        <Scanning label="Waiting for the answer" />
      ) : (
        <Button size="sm" variant="primary" onClick={() => void pairDevice(device)}>
          {device.pairing.action}
        </Button>
      )}
    </div>
  );
}

export function statusTag(device: Device): ReactElement {
  if (!device.online) return <Tag tone="alarm">Not answering</Tag>;
  if (device.pairing && !device.pairing.paired) return <Tag>Not paired</Tag>;
  if (device.pairing) return <Tag tone="mint">Paired</Tag>;
  return <Tag tone="mint">Online</Tag>;
}

/** Everything about one device: state, problems, pairing and every control it offers. */
export function DevicePanel({ device, at }: { device: Device; at: number }): ReactElement {
  const error = useControl((s) => s.errors[device.id]);
  const Icon = KIND[device.kind].icon;
  // Levels and switches sit together in the first row, then plain actions as one row of buttons. Everything else
  // follows in the driver's order.
  const primary = device.capabilities.filter((c) => c.kind === "level" || c.kind === "switch");
  const buttons = device.capabilities.filter((c): c is CapabilityOf<"action"> => c.kind === "action" && !c.input);
  const shown = new Set([...primary, ...buttons].map((c) => c.id));
  const rest = device.capabilities.filter((c) => !shown.has(c.id));
  const levels = primary.filter((c) => c.kind === "level");
  const switches = primary.filter((c) => c.kind === "switch");

  return (
    <motion.div key={device.id} className="control-device" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", duration: 0.35, bounce: 0 }}>
      <header className="control-device__head">
        <span className="control-device__icon">
          <Icon size={16} strokeWidth={1.6} />
        </span>
        <div className="control-device__titles">
          <h3 className="control-device__name">{device.name}</h3>
          <div className="control-device__kicker">{[KIND[device.kind].label, device.model].filter(Boolean).join(" · ")}</div>
        </div>
        {statusTag(device)}
      </header>

      {device.problem && <p className="control-device__problem">{device.problem}</p>}
      {error && (
        <p className="control-device__problem" role="alert">
          {error}
        </p>
      )}
      <PairBlock device={device} />

      {primary.length > 0 && (
        <div className={`control-device__primary${levels.length ? "" : " control-device__primary--switches"}`}>
          {levels.map((c) => (
            <CapabilityView key={c.id} device={device} c={c} at={at} />
          ))}
          {switches.length > 0 && (
            <div className="control-device__switches">
              {switches.map((c) => (
                <CapabilityView key={c.id} device={device} c={c} at={at} />
              ))}
            </div>
          )}
        </div>
      )}

      {buttons.length > 0 && (
        <section className="control-cap">
          <div className="v-eyebrow">Actions</div>
          <div className="control-device__buttons">
            {buttons.map((c) => (
              <ActionControl key={c.id} device={device} c={c} />
            ))}
          </div>
        </section>
      )}

      {rest.map((c) => (
        <section key={c.id} className="control-cap">
          <div className="v-eyebrow">{c.label}</div>
          <CapabilityView device={device} c={c} at={at} />
        </section>
      ))}
      {device.capabilities.length === 0 && device.online && !device.pairing && <p className="dim">This device reports nothing to control.</p>}
    </motion.div>
  );
}
