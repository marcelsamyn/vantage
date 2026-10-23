/** Payloads served by /api/phone. Shared by api.ts (server) and the browser code. */

/** Where a tailnet owner turns on HTTPS certificates. */
export const ADMIN_DNS_URL = "https://login.tailscale.com/admin/dns";

export interface PhoneStatus {
  /** `missing`: no Tailscale command found. `stopped`: installed, but not connected to a tailnet. */
  tailscale: "missing" | "stopped" | "running";
  /** This Mac's MagicDNS name, such as `my-mac.example-tailnet.ts.net`. Null while Tailscale is not running. */
  name: string | null;
  /** Whether the tailnet has HTTPS certificates for that name. Tailscale Serve needs them. */
  https: boolean;
  /** Whether `https://<name>/` already proxies to this VANTAGE server. */
  serving: boolean;
  /** What `https://<name>/` shows instead of VANTAGE, when Tailscale Serve already uses it for something else. */
  otherShare: string | null;
  /** The address to open on a phone. Null while Tailscale is not running. */
  url: string | null;
}
