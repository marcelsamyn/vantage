import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { readStored, usePoll, writeStored } from "../../app/core/hooks";
import { fetchDevices, useDeviceStore } from "./client";
import { deviceTitle } from "./labels";

const KNOWN_KEY = "net.known-macs";
const WATCH_EVERY_MS = 3 * 60_000;

/**
 * Headless watcher. Every three minutes it reads the device list (never sweeping) and raises an alert when a MAC
 * address appears that was never seen before. The first run only records what is already there.
 * It also reports when the connection drops and returns.
 */
export default function NetWatcher(): null {
  const { data } = usePoll((signal) => fetchDevices(signal), WATCH_EVERY_MS, []);
  const setLatest = useDeviceStore((s) => s.set);

  useEffect(() => {
    if (!data) return;
    setLatest(data);
    const known = readStored<string[] | null>(KNOWN_KEY, null);
    const macs = data.devices.map((d) => d.mac);
    if (known === null) {
      writeStored(KNOWN_KEY, macs);
      return;
    }
    const seen = new Set(known);
    for (const d of data.devices) {
      if (seen.has(d.mac) || d.isThisMac) continue;
      feed(
        {
          level: "alert",
          source: "net",
          title: `New device on your network: ${deviceTitle(d)}`,
          detail: [d.ip, d.vendor, d.randomized ? "private Wi-Fi address" : null].filter(Boolean).join(" · "),
          go: { screen: "net", action: "devices" },
          entity: { kind: "device", id: d.id, data: d },
        },
        { key: `net.new.${d.mac}`, dedupeMs: Number.POSITIVE_INFINITY, toast: true },
      );
    }
    writeStored(KNOWN_KEY, [...new Set([...known, ...macs])]);
  }, [data, setLatest]);

  useEffect(() => {
    const lost = (): void => feed({ level: "alert", source: "net", title: "Connection lost", detail: "This browser reports that the network went offline.", go: { screen: "net", action: "overview" } }, { key: "net.offline", dedupeMs: 5_000, toast: true });
    const back = (): void => feed({ level: "good", source: "net", title: "Back online", detail: "The network connection is working again.", go: { screen: "net", action: "overview" } }, { key: "net.online", dedupeMs: 5_000, toast: true });
    window.addEventListener("offline", lost);
    window.addEventListener("online", back);
    return () => {
      window.removeEventListener("offline", lost);
      window.removeEventListener("online", back);
    };
  }, []);

  return null;
}
