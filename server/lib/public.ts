import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { HttpError } from "./http";
import { fetchUpstream, type UpstreamInit } from "./upstream";

/**
 * Guards for URLs that come from third parties (a link the user pastes, a directory entry): VANTAGE fetches them
 * from the user's own machine, so a hostile URL must never reach into the user's network.
 */

const PRIVATE_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10], // carrier-grade NAT, also used by some VPNs
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved and broadcast
] as const) PRIVATE_V4.addSubnet(net, prefix, "ipv4");

// IPv6 forms that embed an IPv4 address (mapped, translated, compatible, NAT64, 6to4, Teredo) are refused whole:
// a public site never needs them, and each can carry a private IPv4 address past a check of the outer form.
// Kept apart from PRIVATE_V4 because a BlockList compares IPv4 addresses against its IPv6 rules as mapped addresses.
const PRIVATE_V6 = new BlockList();
for (const [net, prefix] of [
  ["::", 96],
  ["::ffff:0:0", 96],
  ["::ffff:0:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) PRIVATE_V6.addSubnet(net, prefix, "ipv6");

/** True only for an IP literal on the public internet. Hostnames and malformed input are not public. */
export function isPublicAddress(ip: string): boolean {
  const address = ip.replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const family = isIP(address);
  if (family === 4) return !PRIVATE_V4.check(address, "ipv4");
  if (family === 6) return !PRIVATE_V6.check(address, "ipv6");
  return false;
}

const TIMED_OUT = Symbol("timed out");

/**
 * Why a host must not be contacted, or null when every address it resolves to is public.
 * Returns "timeout" when the resolver gives no answer in time, because the OS lookup alone can take 30 s.
 */
export async function publicHostRefusal(host: string, timeoutMs: number): Promise<string | null | "timeout"> {
  const bare = host.replace(/^\[|\]$/g, "");
  if (isIP(bare) !== 0) return isPublicAddress(bare) ? null : `${bare} is a private or loopback address`;
  const answer = await Promise.race([lookup(bare, { all: true }).catch(() => []), new Promise<typeof TIMED_OUT>((done) => setTimeout(done, timeoutMs, TIMED_OUT))]);
  if (answer === TIMED_OUT) return "timeout";
  const bad = answer.find((a) => !isPublicAddress(a.address));
  return bad ? `${bare} resolves to ${bad.address}, a private or loopback address` : null;
}

const MAX_REDIRECTS = 5;

/** Fetch a third-party URL over http(s), checking the address of the first request and of every redirect. */
export async function fetchPublic(source: string, url: string | URL, init: UpstreamInit = {}): Promise<Response> {
  let current = new URL(url);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (current.protocol !== "http:" && current.protocol !== "https:") {
      throw new HttpError(502, "bad_scheme", `${source} points to a ${current.protocol} address, which VANTAGE does not open`);
    }
    const refusal = await publicHostRefusal(current.hostname, init.timeoutMs ?? 12_000);
    if (refusal === "timeout") throw new HttpError(504, "upstream_timeout", `${source}: ${current.hostname} did not resolve in time`);
    if (refusal) throw new HttpError(502, "private_address", `${source} points into a private network (${refusal}), so VANTAGE will not open it`);

    const res = await fetchUpstream(source, current, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    await res.body?.cancel().catch(() => undefined);
    const location = res.headers.get("location");
    if (!URL.canParse(location ?? "", current)) throw new HttpError(502, "bad_redirect", `${source} redirected without a valid address`);
    current = new URL(location ?? "", current);
  }
  throw new HttpError(502, "too_many_redirects", `${source} redirected more than ${MAX_REDIRECTS} times`);
}
