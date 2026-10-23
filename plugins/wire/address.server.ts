import type { HostScope } from "./types";

const MAPPED_V4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;

/** IPv4-mapped IPv6 addresses (::ffff:1.2.3.4) are the same host as the plain IPv4 address. */
export function normalizeIp(ip: string): string {
  return MAPPED_V4.exec(ip)?.[1] ?? ip;
}

/** Loopback and private ranges never leave your network, so they are listed but never sent to a location service. */
export function ipScope(ip: string): HostScope {
  if (ip.includes(".")) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    if (a === 127) return "loopback";
    const private4 = a === 0 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
    return private4 ? "private" : "public";
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::1") return "loopback";
  // :: unspecified, fe80::/10 link-local, fc00::/7 unique local, ff00::/8 multicast
  const private6 = v6 === "::" || /^fe[89ab]/.test(v6) || /^f[cd]/.test(v6) || v6.startsWith("ff");
  return private6 ? "private" : "public";
}
