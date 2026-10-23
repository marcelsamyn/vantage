import { HttpError, run, type MdnsService } from "../../server/kit";
import type { ActKind, ActValues, CapabilityOf, Device, DeviceKind } from "./types";

/**
 * The contract every device driver implements. A driver finds devices (by mDNS service type, or on this Mac),
 * reads their state as capabilities, and performs actions on them. Register a new driver in drivers/index.server.ts.
 */

/** An announced mDNS service together with the IPv4 address its host resolved to. */
export interface Sighting extends MdnsService {
  ip: string;
}

/** Something a driver can talk to: this Mac, an app, a bridge or a printer. Built only from the server's own discovery. */
export interface Endpoint {
  /** Stable id, e.g. "hue:ecb5fafffe0786f2". The ids of the devices it yields are this key or start with "<key>/". */
  key: string;
  driver: string;
  kind: DeviceKind;
  name: string;
  group: string;
  /** True for parts of this Mac. Network endpoints are remembered between scans; local ones are looked up each time. */
  local: boolean;
  /** Address built from discovery, e.g. "https://192.168.1.220:443". Never taken from the browser. */
  url: string | null;
  /**
   * Set by the store when a scan saw this paired endpoint at another address. The paired address stays in `url`; a
   * driver must not send secrets to `movedTo`.
   */
  movedTo?: string;
  /** Facts from discovery the driver needs later, e.g. a bridge id from the TXT record. */
  meta: Record<string, string>;
  /** When discovery last saw it. */
  seenAt: number;
}

/** A validated action: the capability and a value of the type its kind takes. */
export type Act = { [K in ActKind]: { kind: K; capability: CapabilityOf<K>; value: ActValues[K] } }[ActKind];

export interface Driver {
  id: string;
  /** mDNS service types this driver finds devices by. Leave it out for drivers that look on this Mac. */
  mdns?: readonly string[];
  /** Turn what the network announced into endpoints. Local drivers ignore `seen` and look on this Mac. */
  discover(seen: Sighting[]): Promise<Endpoint[]>;
  /** Read live state. A bridge yields itself and the devices behind it. Throw when the endpoint does not answer. */
  read(endpoint: Endpoint): Promise<Device[]>;
  act?(endpoint: Endpoint, device: Device, act: Act): Promise<void>;
  /** Pair with a bridge, or ask macOS to let VANTAGE control an app. */
  pair?(endpoint: Endpoint): Promise<void>;
}

/** The device an endpoint stands for, with fields every driver fills the same way. */
export function deviceOf(endpoint: Endpoint, rest: Partial<Device> & Pick<Device, "capabilities">): Device {
  return {
    id: endpoint.key,
    kind: endpoint.kind,
    name: endpoint.name,
    group: endpoint.group,
    model: null,
    via: null,
    local: endpoint.local,
    online: true,
    problem: null,
    pairing: null,
    ...rest,
  };
}

/**
 * Run AppleScript (or JavaScript for Automation) with values passed as arguments after "--", never spliced into
 * the script source. The script reads them from `argv`.
 */
export async function appleScript(lines: readonly string[], args: readonly string[] = [], { language = "AppleScript", timeoutMs = 10_000 }: { language?: "AppleScript" | "JavaScript"; timeoutMs?: number } = {}): Promise<string> {
  try {
    const out = await run(["osascript", "-l", language, ...lines.flatMap((line) => ["-e", line]), "--", ...args], { timeoutMs });
    return out.trim();
  } catch (err) {
    // -1743: the user declined (or has not yet answered) the macOS Automation prompt for this app.
    if (err instanceof HttpError && err.message.includes("(-1743)")) {
      throw new HttpError(403, "automation_denied", "macOS has not allowed VANTAGE to control this app. Turn it on in System Settings → Privacy & Security → Automation, then try again.");
    }
    throw err;
  }
}
