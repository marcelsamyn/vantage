import { Resolver } from "node:dns/promises";
import { networkInterfaces } from "node:os";
import { HttpError, memo, run } from "../../server/kit";
import { scanBonjour, serviceLabel } from "./bonjour.server";
import { guessKind } from "./kind.server";
import { vendorsOf } from "./oui.server";
import { defaultRoute, machineName } from "./system.server";
import type { NetDevice, NetDevices, SweepResult } from "./types";

/**
 * Devices on the Mac's own subnet. Sources, all passive or local:
 *  - the ARP cache (`arp -an`), which holds every device this Mac talked to recently,
 *  - reverse DNS from the router, Bonjour announcements, and the IEEE vendor registry.
 * `sweep` adds one ping per address of a private /24 or smaller subnet so that quiet devices enter the ARP cache.
 */

// ── IPv4 helpers ──────────────────────────────────────────────────

const ipToInt = (ip: string): number => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0);
const intToIp = (n: number): string => [n / 2 ** 24, (n / 2 ** 16) % 256, (n / 256) % 256, n % 256].map((x) => Math.floor(x)).join(".");

export function isPrivateIpv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function inSubnet(ip: string, base: string, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(ipToInt(ip) / size) === Math.floor(ipToInt(base) / size);
}

interface OwnAddress {
  interface: string;
  ip: string;
  mac: string;
  prefix: number;
}

function ownAddress(iface: string): OwnAddress | null {
  const v4 = networkInterfaces()[iface]?.find((a) => a.family === "IPv4" && !a.internal);
  if (!v4?.cidr) return null;
  return { interface: iface, ip: v4.address, mac: v4.mac, prefix: Number(v4.cidr.split("/")[1]) };
}

// ── ARP ───────────────────────────────────────────────────────────

export interface ArpEntry {
  ip: string;
  mac: string;
  interface: string;
}

/** "8:7c:39:cd:db:d3" → "08:7c:39:cd:db:d3". macOS prints octets without leading zeros. */
export function normalizeMac(mac: string): string {
  return mac
    .split(":")
    .map((o) => o.padStart(2, "0").toLowerCase())
    .join(":");
}

const VIRTUAL_INTERFACE = /^(bridge|vmenet|anpi|ap|awdl|llw|utun|gif|stf)\d*$/;

export function parseArp(output: string): ArpEntry[] {
  const entries: ArpEntry[] = [];
  for (const line of output.split("\n")) {
    const m = /\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5}) on (\S+)/i.exec(line);
    if (!m?.[1] || !m[2] || !m[3]) continue; // "(incomplete)" entries have no MAC and are skipped here
    const mac = normalizeMac(m[2]);
    if (mac === "ff:ff:ff:ff:ff:ff" || mac.startsWith("01:00:5e") || mac.startsWith("33:33")) continue;
    if (VIRTUAL_INTERFACE.test(m[3])) continue;
    entries.push({ ip: m[1], mac, interface: m[3] });
  }
  return entries;
}

// ── Reverse DNS ───────────────────────────────────────────────────

const RDNS_TIMEOUT_MS = 1_500;

/** The router usually answers for the names it handed out by DHCP. Returns the first label, e.g. "marcels-iphone". */
async function reverseName(resolver: Resolver, ip: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), RDNS_TIMEOUT_MS);
  });
  try {
    const names = await Promise.race([resolver.reverse(ip).catch(() => [] as string[]), timeout]);
    const label = names?.[0]?.split(".")[0];
    // Names built from the address itself ("192-168-1-5") carry no information.
    return label && !/^\d+[-.]\d+[-.]\d+[-.]\d+$/.test(label) ? label : null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Assembly ──────────────────────────────────────────────────────

let epoch = 0;

/**
 * Router DNS and mDNS both answer late or not at all now and then, which would make a device's name appear and
 * vanish between scans. A name is remembered per MAC address for an hour and used when a scan finds none.
 */
const NAME_MEMORY_MS = 60 * 60_000;
const knownNames = new Map<string, { name: string; at: number }>();

function stableName(mac: string, found: string | null): string | null {
  const now = Date.now();
  if (found) {
    knownNames.set(mac, { name: found, at: now });
    return found;
  }
  const old = knownNames.get(mac);
  return old && now - old.at < NAME_MEMORY_MS ? old.name : null;
}

async function buildDevices(): Promise<NetDevices> {
  const route = await defaultRoute();
  if (!route.interface) throw new HttpError(503, "offline", "This Mac has no default network route. Connect to Wi-Fi or Ethernet, then try again.");
  const own = ownAddress(route.interface);
  if (!own) throw new HttpError(503, "no_ipv4", `${route.interface} has no IPv4 address, so there is no local network to list.`);

  const arpOutput = await run(["arp", "-an"], { allowFailure: true });
  const entries = parseArp(arpOutput).filter((e) => e.interface === own.interface && inSubnet(e.ip, own.ip, own.prefix) && e.ip !== own.ip);
  const broadcast = intToIp(Math.floor(ipToInt(own.ip) / 2 ** (32 - own.prefix)) * 2 ** (32 - own.prefix) + 2 ** (32 - own.prefix) - 1);
  const peers = entries.filter((e) => e.ip !== broadcast);

  const resolver = new Resolver({ timeout: RDNS_TIMEOUT_MS, tries: 1 });
  const [names, bonjour, vendors, thisName] = await Promise.all([
    Promise.all(peers.map((e) => reverseName(resolver, e.ip))),
    scanBonjour(),
    vendorsOf([own.mac, ...peers.map((e) => e.mac)]),
    machineName(),
  ]);

  const rows = [
    { ip: own.ip, mac: own.mac, rdns: null as string | null, isThisMac: true },
    ...peers.map((e, i) => ({ ip: e.ip, mac: e.mac, rdns: names[i] ?? null, isThisMac: false })),
  ];

  const devices: NetDevice[] = rows.map((r) => {
    const record = bonjour.byIp.get(r.ip);
    const vendor = vendors.get(r.mac) ?? null;
    const randomized = (parseInt(r.mac.slice(0, 2), 16) & 0x02) !== 0;
    const isGateway = r.ip === route.gateway;
    const name = r.isThisMac ? thisName : stableName(r.mac, record?.name ?? r.rdns);
    const types = record?.types ?? [];
    const services = [...new Set(types.map(serviceLabel).filter((s): s is string => s !== null))];
    const model = record?.model ?? null;
    const { kind, note } = guessKind({ isGateway, isThisMac: r.isThisMac, types, serviceLabels: services, model, name, vendor, randomized });
    return { id: r.mac, ip: r.ip, mac: r.mac, name, vendor, randomized, kind, note, services, model, isGateway, isThisMac: r.isThisMac };
  });

  devices.sort((a, b) => Number(b.isThisMac) - Number(a.isThisMac) || Number(b.isGateway) - Number(a.isGateway) || ipToInt(a.ip) - ipToInt(b.ip));
  const network = Math.floor(ipToInt(own.ip) / 2 ** (32 - own.prefix)) * 2 ** (32 - own.prefix);
  return { at: Date.now(), interface: own.interface, subnet: `${intToIp(network)}/${own.prefix}`, bonjour: bonjour.available, devices };
}

export function listDevices(): Promise<NetDevices> {
  return memo(`net:devices:${epoch}`, 30_000, buildDevices);
}

// ── Sweep ─────────────────────────────────────────────────────────

const SWEEP_CONCURRENCY = 32;
let sweeping: Promise<SweepResult> | null = null;

/** Addresses to ping: every host of the subnet except this Mac, the network address and the broadcast address. */
export function sweepTargets(ip: string, prefix: number): string[] {
  const size = 2 ** (32 - prefix);
  const network = Math.floor(ipToInt(ip) / size) * size;
  const out: string[] = [];
  for (let n = network + 1; n < network + size - 1; n++) if (intToIp(n) !== ip) out.push(intToIp(n));
  return out;
}

async function runSweep(): Promise<SweepResult> {
  const route = await defaultRoute();
  if (!route.interface) throw new HttpError(503, "offline", "This Mac has no default network route. Connect to Wi-Fi or Ethernet, then try again.");
  const own = ownAddress(route.interface);
  if (!own) throw new HttpError(503, "no_ipv4", `${route.interface} has no IPv4 address, so there is no local network to sweep.`);
  if (!isPrivateIpv4(own.ip)) throw new HttpError(400, "not_private", `${own.ip} is not a private address (10.x, 172.16-31.x or 192.168.x), so VANTAGE will not sweep this network.`);
  if (own.prefix < 24) throw new HttpError(400, "subnet_too_large", `The subnet ${own.ip}/${own.prefix} is larger than a /24 (254 addresses), so VANTAGE will not sweep it.`);

  const targets = sweepTargets(own.ip, own.prefix);
  let next = 0;
  // One ping per address, a fixed pool of workers. A missing reply is the normal outcome for most addresses.
  const worker = async (): Promise<void> => {
    while (next < targets.length) {
      const target = targets[next++];
      if (target) await run(["ping", "-c", "1", "-t", "1", target], { timeoutMs: 4_000, allowFailure: true }).catch(() => "");
    }
  };
  await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, targets.length) }, worker));

  epoch++;
  const list = await listDevices();
  return { ...list, swept: targets.length };
}

/** Concurrent sweep requests share one run. */
export function sweep(): Promise<SweepResult> {
  sweeping ??= runSweep().finally(() => {
    sweeping = null;
  });
  return sweeping;
}
