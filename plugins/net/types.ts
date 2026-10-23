/** Payloads served by /api/net. Shared by api.ts (server) and client.ts. */

// ── Overview ──────────────────────────────────────────────────────

export interface NetInterface {
  name: string;
  /** Human label such as "Wi-Fi", "Ethernet", "VPN tunnel" or "Virtual bridge". */
  label: string;
  mac: string | null;
  /** Addresses in CIDR form, e.g. "192.168.1.59/24". */
  ipv4: string[];
  /** Global IPv6 addresses in CIDR form. Link-local addresses are left out. */
  ipv6: string[];
  isDefault: boolean;
}

export interface WifiSummary {
  ssid: string | null;
  channel: number;
  band: WifiBand;
  widthMhz: number;
  signalDbm: number | null;
  snrDb: number | null;
  txRateMbps: number | null;
}

export interface NetOverview {
  hostname: string;
  interfaces: NetInterface[];
  gateway: { ip: string | null; interface: string | null };
  dns: { servers: string[]; interface: string | null };
  /** Null when the Mac has no Wi-Fi link, or while the first Wi-Fi scan (about 5 s) is still running. */
  wifi: WifiSummary | null;
  wifiPending: boolean;
}

// ── Counters ──────────────────────────────────────────────────────

export interface InterfaceCounter {
  name: string;
  rxBytes: number;
  txBytes: number;
}

export interface NetCounters {
  at: number;
  /** Interface that carries the default route, or null when the Mac is offline. */
  primary: string | null;
  interfaces: InterfaceCounter[];
}

// ── Wi-Fi ─────────────────────────────────────────────────────────

export type WifiBand = "2.4" | "5" | "6";

export interface WifiNetwork {
  /** Null when macOS hides names (Location Services not granted). */
  ssid: string | null;
  channel: number;
  band: WifiBand;
  widthMhz: number;
  phy: string | null;
  security: string | null;
  signalDbm: number | null;
  noiseDbm: number | null;
  snrDb: number | null;
  txRateMbps: number | null;
  countryCode: string | null;
}

export interface WifiInfo {
  at: number;
  /** Wi-Fi interface name, or null when the Mac has no Wi-Fi adapter. */
  interface: string | null;
  connected: boolean;
  current: WifiNetwork | null;
  nearby: WifiNetwork[];
  /** True when macOS replaced network names with "<redacted>". */
  namesHidden: boolean;
}

// ── Devices ───────────────────────────────────────────────────────

export type DeviceKind = "router" | "computer" | "phone" | "tablet" | "tv" | "speaker" | "printer" | "camera" | "console" | "iot" | "unknown";

export interface NetDevice {
  /** The MAC address, which is unique on the local network. */
  id: string;
  ip: string;
  mac: string;
  /** Best friendly name from Bonjour, the router's DNS, or the Mac itself. Null when nothing announces one. */
  name: string | null;
  vendor: string | null;
  /** True when the MAC has the locally-administered bit set: a private Wi-Fi address that hides the maker. */
  randomized: boolean;
  kind: DeviceKind;
  /** One factual sentence about how the kind was guessed, or null when nothing was learned. */
  note: string | null;
  /** Friendly names of Bonjour services the device announces, e.g. "AirPlay". */
  services: string[];
  /** Hardware model the device announces, e.g. "AppleTV6,2". */
  model: string | null;
  isGateway: boolean;
  isThisMac: boolean;
}

export interface NetDevices {
  at: number;
  interface: string;
  /** The Mac's own subnet in CIDR form. */
  subnet: string | null;
  /** False when `dns-sd` could not run, so names and services are missing. */
  bonjour: boolean;
  devices: NetDevice[];
}

export interface SweepResult extends NetDevices {
  /** How many addresses were pinged. */
  swept: number;
}

// ── Speed test ────────────────────────────────────────────────────

export type SpeedPhase = "ping" | "download" | "upload";

export interface SpeedProgress {
  type: "progress";
  phase: SpeedPhase;
  /** 0 to 1 within the phase. */
  progress: number;
  /** Current throughput in the phase. Zero during the ping phase. */
  mbps: number;
  /** Median latency so far, only during the ping phase. */
  pingMs?: number;
}

export interface SpeedResult {
  type: "result";
  downMbps: number;
  upMbps: number;
  pingMs: number;
  jitterMs: number;
  /** Cloudflare data centre that served the test, e.g. "MXP". */
  colo: string | null;
  at: number;
}

export interface SpeedFailure {
  error: { code: string; message: string };
}

export type SpeedEvent = SpeedProgress | SpeedResult | SpeedFailure;

// ── Entities ──────────────────────────────────────────────────────

declare module "../../app/core/plugin" {
  interface EntityKinds {
    device: NetDevice;
  }
}
