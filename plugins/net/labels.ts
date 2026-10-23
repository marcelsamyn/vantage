import { fmt } from "../../app/core/format";
import type { Tone } from "../../app/ui";
import type { DeviceKind, NetDevice, WifiNetwork } from "./types";

export const KIND_LABEL: Record<DeviceKind, string> = {
  router: "Router",
  computer: "Computer",
  phone: "Phone",
  tablet: "Tablet",
  tv: "TV or player",
  speaker: "Speaker",
  printer: "Printer",
  camera: "Camera",
  console: "Game console",
  iot: "Smart home",
  unknown: "Unidentified",
};

/** Order in which kinds are grouped around the constellation. */
export const KIND_ORDER: DeviceKind[] = ["computer", "phone", "tablet", "tv", "speaker", "console", "iot", "camera", "printer", "router", "unknown"];

/** Name to show for a device: its own name, else its kind and maker, else its address. */
export function deviceTitle(d: NetDevice): string {
  if (d.name) return d.name;
  if (d.isGateway) return "Router";
  if (d.vendor) return `${d.vendor} ${d.kind === "unknown" ? "device" : KIND_LABEL[d.kind].toLowerCase()}`;
  return d.randomized ? "Private device" : d.ip;
}

/** Split a rate in bits per second into a number and a unit, e.g. 12_300_000 → { value: "12.3", unit: "Mb/s" }. */
export function rateParts(bps: number): { value: string; unit: string } {
  const [text, unit] = fmt.bitsPerSecond(bps).split(" ");
  return { value: text ?? "0", unit: unit ?? "b/s" };
}

export type SignalQuality = { label: "Excellent" | "Good" | "Fair" | "Weak"; tone: Tone | undefined };

export function signalQuality(dbm: number): SignalQuality {
  if (dbm >= -50) return { label: "Excellent", tone: "mint" };
  if (dbm >= -60) return { label: "Good", tone: "mint" };
  if (dbm >= -70) return { label: "Fair", tone: undefined };
  return { label: "Weak", tone: "alarm" };
}

export const bandLabel = (band: WifiNetwork["band"]): string => `${band} GHz`;
