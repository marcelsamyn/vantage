import { run } from "../../server/kit";
import { normalizeIp } from "./address.server";

export interface Endpoint {
  /** "*" means every interface. */
  address: string;
  port: number | null;
}

export interface OpenSocket {
  process: string;
  pid: number;
  protocol: "TCP" | "UDP";
  local: Endpoint;
  /** Null for sockets that wait for peers. */
  remote: Endpoint | null;
}

/** lsof escapes unusual bytes in command names as \xNN (a space becomes \x20). */
const decodeName = (raw: string): string => raw.replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

const ENDPOINT = /^(?:\[(.+)\]|(.+)):(\d+|\*)$/;

function parseEndpoint(text: string): Endpoint | null {
  const m = ENDPOINT.exec(text);
  if (!m) return null;
  const address = normalizeIp(m[1] ?? m[2] ?? "");
  const port = m[3] === "*" ? null : Number(m[3]);
  return address ? { address, port } : null;
}

/** Parse `lsof -nP +c 0` output. One row per file descriptor, so a socket shared by two descriptors appears once. */
export function parseLsof(output: string, protocol: "TCP" | "UDP"): OpenSocket[] {
  const seen = new Set<string>();
  const sockets: OpenSocket[] = [];
  for (const row of output.split("\n")) {
    const cols = row.trim().split(/\s+/);
    // COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME [(STATE)]
    const [command, pid, , , , , , , name] = cols;
    if (!command || !pid || !name || command === "COMMAND") continue;
    const [localText = "", remoteText] = name.split("->");
    const local = parseEndpoint(localText);
    if (!local) continue;
    const remote = remoteText ? parseEndpoint(remoteText) : null;
    const key = `${pid}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sockets.push({ process: decodeName(command), pid: Number(pid), protocol, local, remote });
  }
  return sockets;
}

/** lsof as a normal user lists only this user's processes; that is the point, and it needs no sudo. */
export async function readSockets(protocol: "TCP" | "UDP", mode: "established" | "listening"): Promise<OpenSocket[]> {
  const filter = protocol === "TCP" ? ["-iTCP", mode === "established" ? "-sTCP:ESTABLISHED" : "-sTCP:LISTEN"] : ["-iUDP"];
  // Exit code 1 only means "nothing matched"; the output is still what we want.
  const output = await run(["lsof", "-nP", ...filter, "+c", "0"], { allowFailure: true, timeoutMs: 15_000 });
  return parseLsof(output, protocol);
}
