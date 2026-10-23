import { hostname, networkInterfaces } from "node:os";
import { memo, run } from "../../server/kit";
import type { InterfaceCounter, NetCounters, NetInterface } from "./types";

/** Local system facts: default route, DNS, interfaces and byte counters. Every value comes from a macOS command. */

export interface DefaultRoute {
  gateway: string | null;
  interface: string | null;
}

/** Parse `route -n get default`. Returns nulls when the Mac has no default route (offline). */
export function parseRoute(output: string): DefaultRoute {
  const field = (name: string): string | null => new RegExp(`^\\s*${name}:\\s*(\\S+)`, "m").exec(output)?.[1] ?? null;
  return { gateway: field("gateway"), interface: field("interface") };
}

export function defaultRoute(): Promise<DefaultRoute> {
  return memo("net:route", 3_000, async () => {
    // `route` exits with 1 and prints "not in table" when there is no default route.
    const output = await run(["route", "-n", "get", "default"], { allowFailure: true }).catch(() => "");
    return parseRoute(output);
  });
}

// ── DNS ───────────────────────────────────────────────────────────

interface Resolver {
  servers: string[];
  interface: string | null;
  supplemental: boolean;
}

export function parseResolvers(output: string): Resolver[] {
  const resolvers: Resolver[] = [];
  for (const block of output.split(/^resolver #\d+$/m).slice(1)) {
    const servers = [...block.matchAll(/nameserver\[\d+\]\s*:\s*(\S+)/g)].map((m) => m[1] ?? "");
    if (servers.length === 0) continue;
    resolvers.push({
      servers,
      interface: /if_index\s*:\s*\d+\s*\((\w+)\)/.exec(block)?.[1] ?? null,
      supplemental: /flags\s*:.*Supplemental/.test(block),
    });
  }
  return resolvers;
}

/**
 * The resolver that serves ordinary lookups: the one bound to the default-route interface, otherwise the first
 * that is not "Supplemental" (VPN and tailnet resolvers only answer for their own domains).
 */
export async function dnsServers(primary: string | null): Promise<{ servers: string[]; interface: string | null }> {
  const output = await memo("net:dns", 10_000, () => run(["scutil", "--dns"]));
  const resolvers = parseResolvers(output);
  const pick = resolvers.find((r) => r.interface === primary && !r.supplemental) ?? resolvers.find((r) => !r.supplemental) ?? resolvers[0];
  return pick ? { servers: pick.servers, interface: pick.interface } : { servers: [], interface: null };
}

// ── Interfaces ────────────────────────────────────────────────────

/** Hardware port names from `networksetup`, e.g. en0 → "Wi-Fi". */
async function portLabels(): Promise<Map<string, string>> {
  const output = await memo("net:ports", 300_000, () => run(["networksetup", "-listallhardwareports"]));
  const labels = new Map<string, string>();
  for (const m of output.matchAll(/Hardware Port:\s*(.+)\nDevice:\s*(\S+)/g)) labels.set(m[2] ?? "", m[1] ?? "");
  return labels;
}

function fallbackLabel(name: string): string {
  if (name.startsWith("utun")) return "VPN tunnel";
  if (name.startsWith("bridge")) return "Virtual bridge";
  if (name.startsWith("awdl")) return "AirDrop link";
  return "Network link";
}

export async function listInterfaces(primary: string | null): Promise<NetInterface[]> {
  const labels = await portLabels();
  const out: NetInterface[] = [];
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    const external = (addrs ?? []).filter((a) => !a.internal);
    const ipv4 = external.filter((a) => a.family === "IPv4").map((a) => a.cidr ?? a.address);
    const ipv6 = external.filter((a) => a.family === "IPv6" && !a.address.startsWith("fe80")).map((a) => a.cidr ?? a.address);
    if (ipv4.length === 0 && ipv6.length === 0) continue;
    const mac = external.find((a) => a.mac !== "00:00:00:00:00:00")?.mac ?? null;
    out.push({ name, label: labels.get(name) ?? fallbackLabel(name), mac, ipv4, ipv6, isDefault: name === primary });
  }
  // The interface carrying your traffic first, then physical ports, then virtual ones.
  const rank = (i: NetInterface): number => (i.isDefault ? 0 : /^(en|eth)/.test(i.name) ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en", { numeric: true }));
}

export function machineName(): Promise<string> {
  return memo("net:machine-name", 300_000, async () => {
    const name = (await run(["scutil", "--get", "ComputerName"], { allowFailure: true }).catch(() => "")).trim();
    return name || hostname();
  });
}

// ── Counters ──────────────────────────────────────────────────────

const IGNORED = new Set(["lo0", "gif0", "stf0"]);

/**
 * Parse the `<Link#n>` rows of `netstat -ib`. The Address column is empty for some interfaces, so
 * columns are counted from the right: Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll.
 */
export function parseCounters(output: string): InterfaceCounter[] {
  const out: InterfaceCounter[] = [];
  for (const line of output.split("\n")) {
    if (!line.includes("<Link#")) continue;
    const cols = line.trim().split(/\s+/);
    const name = (cols[0] ?? "").replace(/\*$/, "");
    const rxBytes = Number(cols[cols.length - 5]);
    const txBytes = Number(cols[cols.length - 2]);
    if (!name || IGNORED.has(name) || !Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    if (rxBytes === 0 && txBytes === 0) continue;
    out.push({ name, rxBytes, txBytes });
  }
  return out;
}

export async function readCounters(): Promise<NetCounters> {
  const [output, route] = await Promise.all([run(["netstat", "-ib"]), defaultRoute()]);
  return { at: Date.now(), primary: route.interface, interfaces: parseCounters(output) };
}
