import type { LatLon } from "../../shared/geo";
import { locationDoubtful } from "./geo";
import type { HostGeo, TraceHop, WireHost } from "./types";

/** The same program shows up as "Foo", "Foo Helper" and "Foo Helper (Renderer)"; people think of one app. */
export function appName(process: string): string {
  return process.replace(/\s+Helpe?r?\b.*$/, "") || process;
}

const COMPANY_SUFFIX = /[,.\s]+(?:inc|llc|ltd|limited|gmbh|corp|corporation|pbc|co|sa|spa|bv|ag|plc)\.?$/i;

export interface Organisation {
  /** Same for every address the organisation owns. */
  key: string;
  label: string;
}

/** Who runs an address: the network name from the location service, else the reverse DNS domain, else the address. */
export function organisation(host: WireHost): Organisation {
  const geo = host.geo;
  const asMatch = /^AS(\d+)\s+(.*)$/.exec(geo?.as ?? "");
  const raw = asMatch?.[2] ?? geo?.isp ?? geo?.org ?? domainOf(host.rdns) ?? host.ip;
  const label = shorten(raw);
  return { key: asMatch ? `AS${asMatch[1]}` : label.toLowerCase(), label };
}

function shorten(name: string): string {
  let out = name.trim();
  for (let i = 0; i < 2; i++) out = out.replace(COMPANY_SUFFIX, "");
  return out || name;
}

/** "ec2-1-2-3-4.compute.amazonaws.com" → "amazonaws.com". */
function domainOf(rdns: string | null): string | null {
  if (!rdns) return null;
  const parts = rdns.split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : rdns;
}

export const placeLabel = (geo: HostGeo): string => (geo.city ? `${geo.city}, ${geo.country}` : geo.country);

export interface OrgNode {
  id: string;
  label: string;
  countryCode: string | null;
  country: string;
  connections: number;
  hosts: WireHost[];
  apps: Set<string>;
}

/** Public addresses merged into one node per organisation and country, busiest country first. */
export function organisationNodes(hosts: readonly WireHost[]): OrgNode[] {
  const nodes = new Map<string, OrgNode>();
  for (const host of hosts) {
    if (host.scope !== "public") continue;
    const org = organisation(host);
    const countryCode = host.geo?.countryCode ?? null;
    const id = `${countryCode ?? "??"}|${org.key}`;
    const node = nodes.get(id) ?? { id, label: org.label, countryCode, country: host.geo?.country ?? "Not located", connections: 0, hosts: [], apps: new Set<string>() };
    nodes.set(id, node);
    node.connections += host.connections;
    node.hosts.push(host);
    for (const p of host.processes) node.apps.add(appName(p.name));
  }
  const byCountry = new Map<string, number>();
  for (const n of nodes.values()) byCountry.set(n.countryCode ?? "??", (byCountry.get(n.countryCode ?? "??") ?? 0) + n.connections);
  return [...nodes.values()].sort((a, b) => {
    const [ca, cb] = [a.countryCode ?? "??", b.countryCode ?? "??"];
    // Unlocated addresses go last; otherwise the country with more traffic comes first.
    if ((ca === "??") !== (cb === "??")) return ca === "??" ? 1 : -1;
    return (byCountry.get(cb) ?? 0) - (byCountry.get(ca) ?? 0) || ca.localeCompare(cb) || b.connections - a.connections;
  });
}

export const busiestHost = (node: OrgNode): WireHost => node.hosts.reduce((best, h) => (h.connections > best.connections ? h : best));

export interface Destination {
  id: string;
  label: string;
  countryCode: string | null;
  connections: number;
  /** Null for this Mac and the local network, which have no profile. */
  host: WireHost | null;
}

export interface AppRow {
  name: string;
  connections: number;
  destinations: Destination[];
}

/** One row per app, with where its connections go (organisations for the internet, one entry each for local traffic). */
export function appRows(hosts: readonly WireHost[]): AppRow[] {
  const apps = new Map<string, { connections: number; destinations: Map<string, Destination> }>();
  for (const host of hosts) {
    const org = organisation(host);
    for (const p of host.processes) {
      const name = appName(p.name);
      const app = apps.get(name) ?? { connections: 0, destinations: new Map() };
      apps.set(name, app);
      app.connections += p.connections;
      const [id, label, countryCode] =
        host.scope === "public" ? ([`${host.geo?.countryCode ?? "??"}|${org.key}`, org.label, host.geo?.countryCode ?? null] as const) : host.scope === "loopback" ? (["this-mac", "This Mac", null] as const) : (["lan", "Local network", null] as const);
      const dest = app.destinations.get(id) ?? { id, label, countryCode, connections: 0, host: host.scope === "public" ? host : null };
      app.destinations.set(id, dest);
      dest.connections += p.connections;
      if (dest.host && host.connections > dest.host.connections) dest.host = host;
    }
  }
  return [...apps.entries()]
    .map(([name, a]): AppRow => ({ name, connections: a.connections, destinations: [...a.destinations.values()].sort((x, y) => y.connections - x.connections) }))
    .sort((a, b) => b.connections - a.connections || a.name.localeCompare(b.name));
}

export function connectionStats(hosts: readonly WireHost[]): { destinations: number; countries: number; apps: number; local: number } {
  const pub = hosts.filter((h) => h.scope === "public");
  return {
    destinations: new Set(pub.map((h) => organisation(h).key)).size,
    countries: new Set(pub.flatMap((h) => (h.geo ? [h.geo.countryCode] : []))).size,
    apps: new Set(hosts.flatMap((h) => h.processes.map((p) => appName(p.name)))).size,
    local: hosts.filter((h) => h.scope !== "public").reduce((n, h) => n + h.connections, 0),
  };
}

export interface RouteStop {
  lat: number;
  lon: number;
  /** Hops that share this place, e.g. "9–10". */
  label: string;
  place: string;
}

/**
 * Where a traced route touches the map: the located hops in order, with hops in the same city merged.
 * Hops whose reply came back faster than light could travel to their claimed location are left out.
 */
export function routeStops(origin: LatLon | null, hops: readonly TraceHop[]): RouteStop[] {
  const stops: (RouteStop & { first: number; last: number })[] = [];
  for (const h of hops) {
    if (!h.geo || (origin && h.rttMs !== null && locationDoubtful(origin, h.geo, h.rttMs))) continue;
    const prev = stops[stops.length - 1];
    if (prev && Math.abs(prev.lat - h.geo.lat) < 0.1 && Math.abs(prev.lon - h.geo.lon) < 0.1) {
      prev.last = h.hop;
      prev.label = `${prev.first}–${h.hop}`;
      continue;
    }
    stops.push({ lat: h.geo.lat, lon: h.geo.lon, label: String(h.hop), place: placeLabel(h.geo), first: h.hop, last: h.hop });
  }
  return stops.map(({ lat, lon, label, place }) => ({ lat, lon, label, place }));
}
