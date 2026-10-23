import { useEffect, useRef } from "react";
import { feed } from "../../app/core/feed";
import { usePoll } from "../../app/core/hooks";
import { capabilityOf, fetchDevices, LOW_SUPPLY_PERCENT } from "./client";

const WATCH_EVERY_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

/**
 * Headless watcher. Warns once a day per supply when a printer's ink or toner is below 15 %, and notes when a
 * paired device (a bridge, or an app VANTAGE may control) stops answering.
 */
export default function ControlWatcher(): null {
  const { data } = usePoll((signal) => fetchDevices(false, signal), WATCH_EVERY_MS, []);
  /** Ids of paired devices that answered last time. */
  const answering = useRef(new Set<string>());

  useEffect(() => {
    if (!data) return;
    for (const d of data.devices) {
      for (const s of capabilityOf(d, "supplies")?.supplies ?? []) {
        if (s.percent === null || s.percent >= LOW_SUPPLY_PERCENT) continue;
        feed(
          { level: "alert", source: "control", title: `${d.name}: ${s.name} ${s.type} at ${s.percent} %`, detail: "Order a replacement before it runs out.", go: { screen: "control", action: "open" } },
          { key: `control.supply.${d.id}.${s.name}`, dedupeMs: DAY_MS },
        );
      }
      if (d.online && d.pairing?.paired) answering.current.add(d.id);
      else if (!d.online && answering.current.delete(d.id)) {
        feed({ level: "info", source: "control", title: `${d.name} stopped answering`, detail: d.problem ?? undefined, go: { screen: "control", action: "open" } }, { key: `control.silent.${d.id}`, dedupeMs: 30 * 60_000 });
      }
    }
  }, [data]);

  return null;
}
