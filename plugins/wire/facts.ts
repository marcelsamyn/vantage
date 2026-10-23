import { organisation } from "./model";
import type { WireHost } from "./types";

const DEFAULT_FACT = "Your Mac exchanges encrypted traffic with this server; the contents are not visible here, only the address.";

/** One plain sentence about a remote address, picked from who runs it and which port is in use. */
export function hostFact(host: WireHost): string {
  if (host.scope === "loopback") return "This connection never leaves your Mac. Apps use it to talk to each other, for example a browser reaching a development server.";
  if (host.scope === "private") return "This device is on your local network, so the traffic does not cross the internet.";

  const who = `${organisation(host).label} ${host.geo?.isp ?? ""} ${host.geo?.org ?? ""} ${host.rdns ?? ""}`.toLowerCase();
  const ports = new Set(host.ports);
  const has = (...p: number[]): boolean => p.some((n) => ports.has(n));

  if (has(5223) && (who.includes("apple") || host.rdns?.endsWith("push.apple.com"))) return "Apple push notification servers keep a connection open so messages arrive instantly.";
  if (has(5228) && who.includes("google")) return "Google's push service keeps one connection open, so apps hear about new messages without asking again and again.";
  if (has(53, 853)) return "Your Mac asks this server to turn names into addresses. Whoever runs it can see which names you look up.";
  if (has(993, 143, 587, 465, 995)) return "Your mail app talks to its mail server over this connection.";
  if (has(22)) return "An SSH session: an encrypted remote terminal.";
  if (has(3478)) return "Video-call apps use servers like this to find a direct path between you and the other person.";
  if (who.includes("cloudflare")) return "Cloudflare answers each visitor from a server in a nearby city, so the machine you reach can be closer than the map shows.";
  if (who.includes("amazon")) return "Amazon Web Services rents servers to thousands of companies, so this address tells you where an app is hosted more than who runs it.";
  if (who.includes("microsoft")) return "Microsoft rents out servers to many companies, so this address can belong to a service other than Microsoft's own.";
  if (who.includes("akamai") || who.includes("fastly")) return "A content delivery network: it keeps copies of popular files in many cities so downloads start close to you.";
  return DEFAULT_FACT;
}
