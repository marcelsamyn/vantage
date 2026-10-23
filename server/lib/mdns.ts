import { lines } from "./exec";

/**
 * Bonjour (mDNS) browsing through macOS's own `dns-sd`. It only listens for what devices announce on the local
 * network; it never connects to any service.
 *
 * `dns-sd` runs until it is killed, so each call gets a time window. A full scan runs three kinds of window:
 *   1. `browseServiceTypes`: the list of service types on the network,
 *   2. `browseServices`: the instances of one type (`-Z` prints name, host, port and TXT together),
 *   3. `resolveHostIpv4`: the IPv4 addresses of one announced host name (`-G v4`).
 */

export interface MdnsService {
  /** Service type, e.g. "_hue._tcp". */
  type: string;
  /** Instance name with DNS-SD escapes undone, e.g. "Hue Bridge - 0786F2". */
  name: string;
  /** Announced host name without the trailing dot, e.g. "ecb5fa0786f2.local". */
  host: string;
  port: number;
  /** TXT record entries. Keys are lower case. */
  txt: Record<string, string>;
}

/**
 * Run `dns-sd` for `windowMs`, then stop it. `dns-sd` never exits by itself, so `perl` sets an alarm and then
 * becomes `dns-sd` (exec keeps the alarm). If the server dies before it can kill the process, the alarm still does.
 */
async function collect(cmd: [string, ...string[]], windowMs: number): Promise<string[]> {
  const alarmS = Math.ceil(windowMs / 1000) + 2;
  const out: string[] = [];
  for await (const line of lines(["/usr/bin/perl", "-e", "alarm shift; exec @ARGV", String(alarmS), ...cmd], { timeoutMs: windowMs })) out.push(line);
  return out;
}

/** Undo DNS-SD escaping: "\032" is a space, "\." a dot. */
export function unescapeName(text: string): string {
  return text.replace(/\\(\d{3})/g, (_, d: string) => String.fromCharCode(Number(d))).replace(/\\(.)/g, "$1");
}

/** `dns-sd -B _services._dns-sd._udp local.` rows end in "_tcp.local.   _airplay": the type is name + protocol. */
function parseTypes(output: string[]): string[] {
  const types = new Set<string>();
  for (const line of output) {
    const m = /\bAdd\b.*\s_(tcp|udp)\.local\.\s+(_\S+)\s*$/.exec(line);
    if (m) types.add(`${m[2]}._${m[1]}`);
  }
  return [...types];
}

function parseTxt(text: string): Record<string, string> {
  const txt: Record<string, string> = {};
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const entry = m[1] ?? "";
    const eq = entry.indexOf("=");
    if (eq > 0) txt[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
  }
  return txt;
}

/** Parse the zone-file style output of `dns-sd -Z`, which repeats each record once per network interface. */
function parseServices(output: string[]): MdnsService[] {
  const byKey = new Map<string, MdnsService>();
  for (const line of output) {
    const srv = /^(\S+?)\.(_[\w-]+\._(?:tcp|udp))\s+SRV\s+\d+\s+\d+\s+(\d+)\s+(\S+)/.exec(line);
    if (srv) {
      const type = srv[2] ?? "";
      const name = unescapeName(srv[1] ?? "");
      const key = `${type}|${name}`;
      byKey.set(key, { type, name, host: (srv[4] ?? "").replace(/\.$/, ""), port: Number(srv[3]), txt: byKey.get(key)?.txt ?? {} });
      continue;
    }
    const txt = /^(\S+?)\.(_[\w-]+\._(?:tcp|udp))\s+TXT\s+(.*)$/.exec(line);
    if (txt) {
      const type = txt[2] ?? "";
      const name = unescapeName(txt[1] ?? "");
      const hit = byKey.get(`${type}|${name}`);
      if (hit) hit.txt = parseTxt(txt[3] ?? "");
      else byKey.set(`${type}|${name}`, { type, name, host: "", port: 0, txt: parseTxt(txt[3] ?? "") });
    }
  }
  return [...byKey.values()].filter((s) => s.host);
}

function parseAddresses(output: string[]): string[] {
  const ips = new Set<string>();
  for (const line of output) {
    const m = /\bAdd\b\s+\S+\s+\d+\s+\S+\s+(\d{1,3}(?:\.\d{1,3}){3})\s/.exec(line);
    if (m?.[1]) ips.add(m[1]);
  }
  return [...ips];
}

/** Every service type announced on the local network, e.g. ["_airplay._tcp", "_hue._tcp"]. */
export async function browseServiceTypes(windowMs: number): Promise<string[]> {
  return parseTypes(await collect(["dns-sd", "-B", "_services._dns-sd._udp", "local."], windowMs));
}

/** The announced instances of one service type, with host, port and TXT record. */
export async function browseServices(type: string, windowMs: number): Promise<MdnsService[]> {
  return parseServices(await collect(["dns-sd", "-Z", type, "local."], windowMs));
}

/** The IPv4 addresses an mDNS host name resolves to. */
export async function resolveHostIpv4(host: string, windowMs: number): Promise<string[]> {
  return parseAddresses(await collect(["dns-sd", "-G", "v4", host], windowMs));
}
