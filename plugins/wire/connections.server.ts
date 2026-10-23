import { ipScope } from "./address.server";
import { reverseName } from "./dns.server";
import { geolocate } from "./geo.server";
import { readSockets } from "./lsof.server";
import { portInfo, processAbout } from "./ports";
import type { HostProcess, HostScope, ListeningSocket, WireConnections, WireHost, WireListening } from "./types";

interface Group {
  ip: string;
  scope: HostScope;
  connections: number;
  ports: Map<number, number>;
  processes: Map<string, { connections: number; ports: Set<number> }>;
}

const SCOPE_ORDER: Record<HostScope, number> = { public: 0, private: 1, loopback: 2 };

/** Established TCP connections of this user's processes, grouped by the address on the other end. */
export async function readConnections(): Promise<WireConnections> {
  const sockets = await readSockets("TCP", "established");
  const groups = new Map<string, Group>();
  let total = 0;

  for (const s of sockets) {
    if (!s.remote || s.remote.port === null) continue;
    total++;
    const ip = s.remote.address;
    const group = groups.get(ip) ?? { ip, scope: ipScope(ip), connections: 0, ports: new Map(), processes: new Map() };
    groups.set(ip, group);
    group.connections++;
    group.ports.set(s.remote.port, (group.ports.get(s.remote.port) ?? 0) + 1);
    const proc = group.processes.get(s.process) ?? { connections: 0, ports: new Set<number>() };
    group.processes.set(s.process, proc);
    proc.connections++;
    proc.ports.add(s.remote.port);
  }

  const all = [...groups.values()];
  const publicIps = all.filter((g) => g.scope === "public").map((g) => g.ip);
  const [located, names] = await Promise.all([geolocate(publicIps), Promise.all(all.map((g) => (g.scope === "loopback" ? null : reverseName(g.ip))))]);

  const hosts = all.map((g, i): WireHost => {
    const busiestPort = [...g.ports.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const info = busiestPort === undefined ? null : portInfo(busiestPort);
    return {
      ip: g.ip,
      scope: g.scope,
      rdns: names[i] ?? null,
      geo: located.geo.get(g.ip) ?? null,
      connections: g.connections,
      ports: [...g.ports.keys()].sort((a, b) => a - b),
      service: info && !info.temporary ? info.name : null,
      processes: [...g.processes.entries()]
        .map(([name, p]): HostProcess => ({ name, connections: p.connections, ports: [...p.ports].sort((a, b) => a - b) }))
        .sort((a, b) => b.connections - a.connections || a.name.localeCompare(b.name)),
    };
  });
  hosts.sort((a, b) => SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || b.connections - a.connections || a.ip.localeCompare(b.ip));

  return { fetchedAt: Date.now(), total, hosts, geoNote: located.problem };
}

/** Sockets of this user's processes that wait for connections, TCP and UDP. */
export async function readListening(): Promise<WireListening> {
  const [tcp, udp] = await Promise.all([readSockets("TCP", "listening"), readSockets("UDP", "listening")]);
  const merged = new Map<string, ListeningSocket>();

  // A bound UDP socket has no peer and a port; connected UDP sockets belong to the connections view.
  for (const s of [...tcp, ...udp.filter((u) => u.remote === null)]) {
    if (s.local.port === null || s.local.port === 0) continue;
    const exposed = ipScope(s.local.address) !== "loopback";
    const key = `${s.process}|${s.protocol}|${s.local.port}`;
    const known = merged.get(key);
    // IPv4 and IPv6 sockets of one service are one row. If either is reachable, the row is.
    if (known) {
      if (exposed && !known.exposed) {
        known.exposed = true;
        known.address = s.local.address;
      }
      continue;
    }
    const info = portInfo(s.local.port);
    const named = info && !info.temporary;
    merged.set(key, {
      process: s.process,
      pid: s.pid,
      protocol: s.protocol,
      port: s.local.port,
      address: s.local.address,
      exposed,
      service: named ? info.name : null,
      about: named ? info.about : (processAbout(s.process) ?? info?.about ?? null),
    });
  }

  const sockets = [...merged.values()].sort((a, b) => Number(b.exposed) - Number(a.exposed) || a.process.localeCompare(b.process) || a.port - b.port);
  return { fetchedAt: Date.now(), sockets };
}
