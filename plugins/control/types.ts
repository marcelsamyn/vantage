/**
 * Payloads served by /api/control. Shared by api.ts, the drivers and the browser.
 *
 * Every device is described by capabilities, and the browser draws controls from capabilities alone.
 * A new device type is one new driver on the server; the browser needs no change.
 */

/** How a device is drawn in the constellation. Pick the closest one for a new driver. */
export type DeviceKind = "computer" | "player" | "automation" | "hub" | "light" | "printer" | "speaker" | "tv" | "plug" | "other";

export type MediaState = "playing" | "paused" | "stopped";
export type MediaCommand = "playpause" | "pause" | "next" | "previous";

export interface Track {
  title: string;
  artist: string | null;
  album: string | null;
  /** Seconds, or null for live streams. */
  duration: number | null;
  /** Seconds into the track when the state was read. */
  position: number | null;
  /** Album art the browser can load directly, when the player offers one. */
  artwork: string | null;
}

export interface ChoiceOption {
  id: string;
  label: string;
}

export interface Supply {
  name: string;
  /** "toner", "ink", "drum" and so on, as the printer reports it. */
  type: string;
  /** Percent left, or null when the printer cannot measure it. */
  percent: number | null;
  /** The supply's own colour as the printer reports it, e.g. "#00FFFF" for cyan ink. */
  color: string | null;
}

interface Base {
  /** Unique within the device, e.g. "volume". This is what POST /act names. */
  id: string;
  label: string;
  /**
   * When set, the browser asks first, showing `text` exactly, with a button named `action`.
   * In a choice, "{label}" in either stands for the chosen option.
   */
  confirm?: { text: string; action: string };
}

/**
 * What Blackout does to this capability, in words ("Turn off Desk lamp"). Blackout applies the kind's off value:
 * a switch goes off, media pauses, an action runs. The server sets it only when the step would change something.
 */
interface Blackout {
  blackout?: string;
}

export type Capability =
  | (Base & Blackout & { kind: "switch"; on: boolean })
  /** 0–100: brightness, volume. */
  | (Base & { kind: "level"; value: number })
  /** "#rrggbb" */
  | (Base & { kind: "color"; hex: string })
  | (Base & Blackout & { kind: "media"; state: MediaState; track: Track | null })
  /** Pick one: inputs, scenes, shortcuts, appearance. `current` is null when nothing is selected or it is unknown. */
  | (Base & { kind: "choice"; options: ChoiceOption[]; current: string | null })
  /** A named action, optionally with text, such as "Speak". */
  | (Base & Blackout & { kind: "action"; input?: { placeholder: string; maxLength: number } })
  | (Base & { kind: "supplies"; supplies: Supply[] })
  | (Base & { kind: "info"; rows: [string, string][] });

export type CapabilityKind = Capability["kind"];
export type CapabilityOf<K extends CapabilityKind> = Extract<Capability, { kind: K }>;

/** The value POST /act carries for each kind of capability. Read-only kinds take none. */
export interface ActValues {
  switch: boolean;
  level: number;
  color: string;
  media: MediaCommand;
  choice: string;
  action: string | null;
}
export type ActKind = keyof ActValues;

/** Pairing with a bridge (press its button) or allowing macOS to let VANTAGE control an app. */
export interface Pairing {
  paired: boolean;
  /** What happens or what to do first, in plain words. */
  prompt: string;
  /** Button label, e.g. "Pair" or "Allow". */
  action: string;
}

export interface Device {
  /** Stable across scans, e.g. "hue:ecb5fafffe0786f2/light/3". */
  id: string;
  kind: DeviceKind;
  name: string;
  /** Room or category the constellation groups the device under. */
  group: string;
  model: string | null;
  /** The device this one is reached through, e.g. a light's bridge. Null when VANTAGE talks to it directly. */
  via: string | null;
  /** True for devices that are part of this Mac (apps, Shortcuts); false for devices on the network. */
  local: boolean;
  /** False when the device did not answer the last read. */
  online: boolean;
  /** Why the device could not be read or controlled, in plain words. */
  problem: string | null;
  /** Null when the device needs no pairing. */
  pairing: Pairing | null;
  capabilities: Capability[];
}

export interface ControlDevices {
  at: number;
  /** When the network was last browsed for devices, or null before the first scan has finished. */
  scannedAt: number | null;
  /** True while a network scan runs in the background. */
  scanning: boolean;
  /** Why the last scan failed, in plain words. */
  scanProblem: string | null;
  devices: Device[];
}

export interface ActRequest<K extends ActKind = ActKind> {
  deviceId: string;
  capability: string;
  value: ActValues[K];
}

export interface PairRequest {
  deviceId: string;
}
