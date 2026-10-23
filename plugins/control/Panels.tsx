import { motion, type MotionProps } from "motion/react";
import type { ReactElement } from "react";
import { Empty, Panel, Readout } from "../../app/ui";
import { capabilityOf } from "./client";
import { ChoiceControl, MediaControl, PairBlock, statusTag, SuppliesView } from "./Controls";
import type { Device } from "./types";

/** The panels under the constellation gather one kind of capability across every device. */

const enter = (i: number): MotionProps => ({
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", duration: 0.4, bounce: 0, delay: 0.05 + i * 0.06 },
});

export function NowPlayingPanel({ devices, at }: { devices: readonly Device[]; at: number }): ReactElement {
  const players = devices.filter((d) => d.kind === "player" || capabilityOf(d, "media"));
  return (
    <Panel title="Now playing" className="control-panel">
      {players.length === 0 ? (
        <Empty title="Nothing is playing">Open Music or Spotify, and what it plays shows here with play, pause and skip.</Empty>
      ) : (
        <div className="control-stack">
          {players.map((d, i) => {
            const media = capabilityOf(d, "media");
            return (
              <motion.div key={d.id} className="control-entry" {...enter(i)}>
                <div className="control-entry__head">
                  <span className="v-eyebrow">{d.name}</span>
                  {statusTag(d)}
                </div>
                {d.problem && <p className="control-device__problem">{d.problem}</p>}
                {media ? <MediaControl device={d} c={media} at={at} /> : <PairBlock device={d} />}
              </motion.div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function PrintersPanel({ devices, scanned }: { devices: readonly Device[]; scanned: boolean }): ReactElement {
  const printers = devices.filter((d) => d.kind === "printer" || capabilityOf(d, "supplies"));
  return (
    <Panel title="Printers" className="control-panel">
      {printers.length === 0 ? (
        <Empty title={scanned ? "No printer found" : "Looking for printers"}>
          VANTAGE finds printers that announce themselves on your network (IPP over Bonjour). A sleeping printer can stay silent: wake it, then select Rescan.
        </Empty>
      ) : (
        <div className="control-stack">
          {printers.map((d, i) => {
            const supplies = capabilityOf(d, "supplies");
            const info = capabilityOf(d, "info");
            return (
              <motion.div key={d.id} className="control-entry" {...enter(i)}>
                <div className="control-entry__head">
                  <span className="control-entry__name">{d.name}</span>
                  {statusTag(d)}
                </div>
                {d.problem && <p className="control-device__problem">{d.problem}</p>}
                {supplies && <SuppliesView c={supplies} />}
                {info && <Readout rows={info.rows} className="control-entry__rows" />}
              </motion.div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}

export function ShortcutsPanel({ devices, query }: { devices: readonly Device[]; query: string }): ReactElement {
  const automations = devices.flatMap((d) => (d.kind === "automation" ? [{ device: d, choice: capabilityOf(d, "choice") }] : []));
  const count = automations.reduce((n, a) => n + (a.choice?.options.length ?? 0), 0);
  return (
    <Panel title={count ? `Shortcuts · ${count}` : "Shortcuts"} className="control-panel control-panel--wide">
      {automations.length === 0 || count === 0 ? (
        <Empty title="No shortcuts yet">Make one in the Shortcuts app, for example to set a HomeKit scene. It shows here within a minute.</Empty>
      ) : (
        automations.map(({ device, choice }) => (choice ? <ChoiceControl key={`${device.id}|${query}`} device={device} c={choice} columns initialQuery={query} /> : null))
      )}
    </Panel>
  );
}
