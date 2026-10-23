import { join } from "node:path";
import { HttpError, run } from "../../../server/kit";
import { deviceOf, type Driver, type Endpoint, type Sighting } from "../driver.server";
import type { Capability, Device, Supply } from "../types";

/**
 * Network printers that announce IPP (`_ipp._tcp`, `_ipps._tcp`). Read-only: state, queue and ink or toner levels,
 * through macOS's `ipptool` and a request that asks only for those attributes.
 */

const STATUS_TEST = join(import.meta.dir, "printer-status.test");

export const statusArgs = (url: string): [string, ...string[]] => ["ipptool", "-T", "5", "-tv", url, STATUS_TEST];

/** Attribute lines after "RECEIVED:" look like `        marker-levels (1setOf integer) = 100,80`. */
export function parseAttributes(output: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const start = output.indexOf("RECEIVED:");
  if (start < 0) return attrs;
  for (const line of output.slice(start).split("\n")) {
    const m = /^\s+([a-z0-9-]+) \([^)]*\) = (.*)$/.exec(line);
    if (m?.[1]) attrs.set(m[1], (m[2] ?? "").trim());
  }
  return attrs;
}

const list = (value: string | undefined): string[] => (value ? value.split(",").map((v) => v.trim()) : []);

/** IPP marker levels are percentages; -1 means unavailable, -2 unknown and -3 "some left". */
export function parseSupplies(attrs: Map<string, string>): Supply[] {
  const types = list(attrs.get("marker-types"));
  const levels = list(attrs.get("marker-levels")).map(Number);
  const colors = list(attrs.get("marker-colors"));
  return list(attrs.get("marker-names")).map((name, i) => {
    const level = levels[i] ?? -2;
    const color = /^#[0-9a-f]{6}/i.exec(colors[i] ?? "")?.[0] ?? null;
    return { name, type: (types[i] ?? "supply").replaceAll("-", " "), percent: level >= 0 ? Math.min(100, level) : null, color };
  });
}

const STATE: Record<string, string> = { idle: "Ready", processing: "Printing", stopped: "Stopped" };

/** "media-empty-error,toner-low-warning" → "Media empty, toner low". "none" means nothing to report. */
export function describeReasons(value: string | undefined): string | null {
  const reasons = list(value)
    .filter((r) => r && r !== "none")
    .map((r) => r.replace(/-(report|warning|error)$/, "").replaceAll("-", " "));
  if (!reasons.length) return null;
  const text = reasons.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const printer: Driver = {
  id: "printer",
  mdns: ["_ipp._tcp", "_ipps._tcp"],

  async discover(seen: Sighting[]): Promise<Endpoint[]> {
    // A printer often announces both IPP and IPP over TLS; one endpoint per printer, preferring plain IPP on the LAN.
    const byPrinter = new Map<string, Sighting>();
    for (const s of [...seen].sort((a, b) => Number(a.type === "_ipps._tcp") - Number(b.type === "_ipps._tcp"))) {
      const id = (s.txt["uuid"] ?? s.host).toLowerCase();
      if (!byPrinter.has(id)) byPrinter.set(id, s);
    }
    return [...byPrinter].map(([id, s]) => ({
      key: `printer:${id}`,
      driver: "printer",
      kind: "printer",
      name: s.name,
      group: "Printers",
      local: false,
      url: `${s.type === "_ipps._tcp" ? "ipps" : "ipp"}://${s.ip}:${s.port || 631}/${(s.txt["rp"] ?? "ipp/print").replace(/^\//, "")}`,
      meta: { ip: s.ip },
      seenAt: Date.now(),
    }));
  },

  async read(endpoint): Promise<Device[]> {
    if (!endpoint.url) throw new HttpError(500, "no_address", `${endpoint.name} has no address yet. Rescan your network.`);
    // ipptool fails, or prints no PASS line, when the printer cannot be reached or refuses; both mean the same here.
    const output = await run(statusArgs(endpoint.url), { timeoutMs: 8_000, allowFailure: true }).catch((err: unknown) => {
      if (err instanceof HttpError && (err.code === "command_failed" || err.code === "command_timeout")) return "";
      throw err;
    });
    if (!/\[PASS\]/.test(output)) throw new HttpError(504, "printer_silent", `${endpoint.name} did not answer. It may be off or out of reach.`);

    const attrs = parseAttributes(output);
    const supplies = parseSupplies(attrs);
    const state = attrs.get("printer-state") ?? "";
    const reasons = describeReasons(attrs.get("printer-state-reasons"));
    const jobs = Number(attrs.get("queued-job-count") ?? "0");
    const message = attrs.get("printer-alert-description") || attrs.get("printer-state-message") || null;

    const rows: [string, string][] = [
      ["State", STATE[state] ?? state],
      ["Queue", jobs === 0 ? "Empty" : `${jobs} job${jobs === 1 ? "" : "s"}`],
    ];
    if (reasons) rows.push(["Needs", reasons]);
    if (message) rows.push(["Message", message]);
    const location = attrs.get("printer-location");
    if (location) rows.push(["Location", location]);
    rows.push(["Address", endpoint.meta["ip"] ?? "Unknown"]);

    const capabilities: Capability[] = [];
    if (supplies.length) capabilities.push({ kind: "supplies", id: "supplies", label: "Supplies", supplies });
    capabilities.push({ kind: "info", id: "status", label: "Status", rows });

    return [
      deviceOf(endpoint, {
        name: attrs.get("printer-info") || endpoint.name,
        model: attrs.get("printer-make-and-model") || null,
        problem: state === "stopped" ? (reasons ?? "The printer has stopped.") : null,
        capabilities,
      }),
    ];
  },
};
