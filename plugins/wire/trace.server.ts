import { lookup } from "node:dns/promises";
import { HttpError, lines } from "../../server/kit";
import { ipScope } from "./address.server";
import { geolocate } from "./geo.server";
import type { HostGeo, TraceEvent, TraceGeo, TraceHop } from "./types";

/** A host name or an IPv4 address: letters, digits, hyphens inside labels, dots between them. Never starts with "-". */
const LABEL = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
const HOST = new RegExp(`^${LABEL}(?:\\.${LABEL})*$`, "i");

/** The `host` query parameter, validated strictly: it ends up as a traceroute argument. */
export function parseHost(req: Request): string {
  const host = new URL(req.url).searchParams.get("host")?.trim() ?? "";
  if (host.length === 0 || host.length > 253 || !HOST.test(host)) {
    throw new HttpError(400, "bad_host", "Enter a host name such as example.com, or an IPv4 address such as 1.1.1.1.");
  }
  return host;
}

/** Resolve once up front so traceroute only ever receives an address, and a typo fails with a clear message. */
export async function resolveHost(host: string): Promise<string> {
  try {
    return (await lookup(host, { family: 4 })).address;
  } catch {
    throw new HttpError(404, "unknown_host", `"${host}" has no IPv4 address. Check the spelling and your internet connection.`);
  }
}

// " 3  10.0.0.1  13.091 ms", " 4  *", " 5  10.0.0.1  2.1 ms !H"
const HOP_LINE = /^\s*(\d+)\s+(.*)$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function parseHop(line: string): { hop: number; ip: string | null; rttMs: number | null } | null {
  const m = HOP_LINE.exec(line);
  if (!m) return null;
  const hop = Number(m[1]);
  const rest = m[2] ?? "";
  const ip = rest.split(/\s+/)[0] ?? "";
  if (!IPV4.test(ip)) return { hop, ip: null, rttMs: null };
  const rtt = /([\d.]+) ms/.exec(rest)?.[1];
  return { hop, ip, rttMs: rtt === undefined ? null : Number(rtt) };
}

/**
 * Stream a traceroute hop by hop. Locations arrive as separate events once the (batched) lookup returns, so a slow
 * lookup never delays the hops themselves. Closing the iterator closes `lines()`, which kills the child process.
 */
export async function* traceRoute(host: string, ip: string): AsyncGenerator<TraceEvent> {
  yield { trace: { host, ip } };

  const locations: Promise<void>[] = [];
  const ready: TraceGeo[] = [];
  let problem: string | null = null;
  let last: string | null = null;

  for await (const line of lines(["traceroute", "-n", "-q", "1", "-w", "1", "-m", "24", ip], { timeoutMs: 60_000 })) {
    const parsed = parseHop(line);
    if (!parsed) continue;
    const scope = parsed.ip ? ipScope(parsed.ip) : null;
    const hop: TraceHop = { ...parsed, scope, geo: null };
    last = parsed.ip;
    yield hop;

    if (parsed.ip && scope === "public") {
      const address = parsed.ip;
      locations.push(
        geolocate([address]).then((result) => {
          problem = result.problem ?? problem;
          const geo: HostGeo | null | undefined = result.geo.get(address);
          if (geo) ready.push({ hop: parsed.hop, geo });
        }),
      );
    }
    for (const patch of ready.splice(0)) yield patch;
  }

  await Promise.all(locations);
  for (const patch of ready.splice(0)) yield patch;
  yield { done: true, reached: last === ip, geoNote: problem };
}
