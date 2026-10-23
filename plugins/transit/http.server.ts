import { fetchUpstream } from "../../server/kit";

/** Sent to every transit source: iRail and Entur ask API users to identify themselves. */
export const IDENTITY = "VANTAGE/1.0 (personal dashboard; local)";

/** Fetch a protobuf file (GTFS-Realtime) and return its bytes. */
export async function fetchBytes(source: string, url: string, timeoutMs = 15_000): Promise<Uint8Array> {
  const res = await fetchUpstream(source, url, { headers: { "user-agent": IDENTITY, accept: "application/x-protobuf, */*" }, timeoutMs });
  return new Uint8Array(await res.arrayBuffer());
}

/** Fetch plain text. */
export async function fetchText(source: string, url: string, timeoutMs = 12_000): Promise<string> {
  const res = await fetchUpstream(source, url, { headers: { "user-agent": IDENTITY, accept: "text/plain, */*" }, timeoutMs });
  return res.text();
}

/** Title-case an upper-case station name: "ROMA TERMINI" becomes "Roma Termini". */
export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(^|[\s./'-])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();
}
