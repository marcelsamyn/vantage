/** Payloads served by /api/reach, plus the small registries both the server and the browser read. */
import type { LatLon } from "../../shared/geo";

// ── Radio receivers (KiwiSDR) ─────────────────────────────────────

export interface Receiver {
  /** The software behind the receiver's web page; it decides how a frequency is passed in the address. */
  kind: "kiwisdr" | "websdr";
  /** KiwiSDR.com's id for the receiver. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Where the owner says it stands, e.g. "Montmorillon 86500 FRANCE". */
  place: string | null;
  antenna: string | null;
  /** Lowest and highest frequency the receiver covers, in hertz. */
  minHz: number;
  maxHz: number;
  /** People listening right now, out of `slots` shared by everyone. Null for a receiver that does not report either. */
  users: number | null;
  slots: number | null;
  /** The receiver's own web interface. */
  url: string;
}

export interface ReceiverList {
  /** When KiwiSDR.com last refreshed its list (the receivers report their own state to it). */
  listedAt: number;
  receivers: Receiver[];
}

export interface EmbedCheck {
  embeddable: boolean;
  /** Why the page cannot be framed, when it cannot. */
  reason: string | null;
}

export type TuneMode = "am" | "usb" | "cw";

/** A signal that is broadcast openly and on the air all day: a fixed target to hear from many places. */
export interface Beacon {
  id: string;
  label: string;
  /** What it carries, in a few words. */
  about: string;
  operator: string;
  /** Where the transmitter stands. */
  from: string;
  /** The transmitter's position, when it is published; without it no "from the transmitter" distance is shown. */
  at: LatLon | null;
  kHz: number;
  mode: TuneMode;
}

export const BEACONS: readonly Beacon[] = [
  { id: "dcf77", label: "DCF77 77.5 kHz", about: "the German time signal", operator: "PTB", from: "Mainflingen, Germany", at: { lat: 50.0156, lon: 9.0108 }, kHz: 77.5, mode: "am" },
  { id: "bbc4lw", label: "BBC Radio 4 198 kHz", about: "BBC Radio 4 on long wave", operator: "BBC", from: "Droitwich, England", at: { lat: 52.2958, lon: -2.1061 }, kHz: 198, mode: "am" },
  { id: "shannon", label: "Shannon VOLMET 5505 kHz", about: "aviation weather read out for airports across Europe", operator: "Irish Aviation Authority", from: "Ireland", at: null, kHz: 5_505, mode: "usb" },
  { id: "buzzer", label: "The Buzzer 4625 kHz", about: "a marker signal that repeats a buzz, known as UVB-76", operator: "unattributed", from: "near Moscow, Russia", at: null, kHz: 4_625, mode: "usb" },
  { id: "wwv10", label: "WWV 10 MHz", about: "the US time signal", operator: "NIST", from: "Fort Collins, Colorado", at: { lat: 40.6803, lon: -105.0408 }, kHz: 10_000, mode: "am" },
  { id: "wwv15", label: "WWV 15 MHz", about: "the US time signal", operator: "NIST", from: "Fort Collins, Colorado", at: { lat: 40.6803, lon: -105.0408 }, kHz: 15_000, mode: "am" },
  { id: "chu", label: "CHU 7.85 MHz", about: "the Canadian time signal", operator: "National Research Council Canada", from: "Ottawa, Ontario", at: { lat: 45.2961, lon: -75.7561 }, kHz: 7_850, mode: "usb" },
];

/** Free seats left; null when the receiver sets no limit. */
export function slotsFree(r: Pick<Receiver, "users" | "slots">): number | null {
  return r.slots === null || r.users === null ? null : Math.max(0, r.slots - r.users);
}

/** A receiver with no seat limit is never full. */
export const isFull = (r: Pick<Receiver, "users" | "slots">): boolean => slotsFree(r) === 0;

/** 0 to 1: how much of the receiver is taken. */
export const loadOf = (r: Pick<Receiver, "users" | "slots">): number => (r.slots !== null && r.users !== null ? r.users / r.slots : 0);

export const seatsText = (r: Pick<Receiver, "users" | "slots">): string => (r.slots === null || r.users === null ? "No seat limit" : `${r.users} of ${r.slots} slots in use`);

export function covers(r: Pick<Receiver, "minHz" | "maxHz">, kHz: number): boolean {
  return r.minHz <= kHz * 1000 && r.maxHz >= kHz * 1000;
}

/**
 * The receiver's own interface, optionally tuned. KiwiSDR reads `f=<kHz><mode>` and `z=<zoom>` from the address
 * (checked against a live receiver: frequency, mode and zoom were set on load). WebSDR reads `tune=<kHz><mode>`.
 */
export function tuneUrl(r: Pick<Receiver, "url" | "kind">, tune?: { kHz: number; mode: TuneMode }): string {
  if (!tune) return r.url;
  const url = new URL(r.url);
  if (r.kind === "websdr") {
    url.searchParams.set("tune", `${tune.kHz}${tune.mode}`);
  } else {
    url.searchParams.set("f", `${tune.kHz.toFixed(2)}${tune.mode}`);
    url.searchParams.set("z", tune.kHz < 1000 ? "0" : "4");
  }
  return url.toString();
}

// ── Satellite ground stations (SatNOGS) ───────────────────────────

export type StationStatus = "online" | "testing";

export interface GroundStation {
  id: number;
  name: string;
  lat: number;
  lon: number;
  altitudeM: number;
  status: StationStatus;
  /** What it listens with, e.g. "UHF · Cross Yagi". */
  antennas: string[];
  observations: number;
  scheduled: number;
  /** Share of observations that were judged good, 0-100; null for a new station. */
  successRate: number | null;
  lastSeen: number;
  /** Who runs the station, as published by SatNOGS; null when the station omits it. */
  owner: string | null;
  /** Set while the station records a pass right now. */
  observing: { satellite: string; endsAt: number } | null;
}

export interface StationList {
  fetchedAt: number;
  stations: GroundStation[];
  /** Registered stations that are offline. They are not listed. */
  offline: number;
  /** Why "observing now" is unknown, when the live check failed. */
  liveError: string | null;
}

export interface Observation {
  id: number;
  satellite: string;
  noradId: number;
  mode: string | null;
  frequencyMhz: number | null;
  startsAt: number;
  endsAt: number;
  maxElevationDeg: number | null;
  waterfall: string | null;
  audio: string | null;
  decodedFrames: number;
  page: string;
}

export interface StationDetail {
  id: number;
  fetchedAt: number;
  recent: Observation[];
  upcoming: Observation[];
}

export const stationPage = (id: number): string => `https://network.satnogs.org/stations/${id}/`;

// ── Work orders (open reports to a city) ──────────────────────────

export type OrderStatus = "open" | "acknowledged";

export interface WorkOrder {
  id: string;
  /** Which reporting service holds it. */
  operator: string;
  /** The body that fixes it, when the service names one, e.g. "Cambridge, MA". */
  authority: string | null;
  category: string;
  status: OrderStatus;
  createdAt: number;
  description: string | null;
  photo: string | null;
  lat: number;
  lon: number;
  /** The report's own page. */
  url: string;
}

export interface OrderSource {
  operator: string;
  error: string | null;
}

export interface OrderList {
  center: LatLon;
  radiusM: number;
  fetchedAt: number;
  orders: WorkOrder[];
  /** Every reporting service that covers this spot, and whether it answered. Empty means none is known here. */
  sources: OrderSource[];
}

export interface ReportLink {
  operator: string;
  url: string;
}

// ── Map notes (OpenStreetMap) ─────────────────────────────────────

export interface NoteComment {
  at: number;
  action: "opened" | "commented" | "closed" | "reopened" | "hidden";
  text: string;
}

export interface MapNote {
  id: number;
  lat: number;
  lon: number;
  status: "open" | "closed" | "hidden";
  createdAt: number;
  comments: NoteComment[];
  url: string;
}

export interface NoteList {
  fetchedAt: number;
  notes: MapNote[];
}

export interface NewNote {
  lat: number;
  lon: number;
  text: string;
}

export interface CreatedNote {
  id: number;
  url: string;
}

export const NOTE_MAX = 2000;

/** The sentence this app suggests: cameras feed the Surveillance layer, which reads OpenStreetMap. */
export const CAMERA_NOTE = "Surveillance camera here, not on the map yet. It faces <direction>.";

// ── World view ────────────────────────────────────────────────────

/** Land as a lattice: row 0 is 90°N, column 0 is 180°W, each cell `stepDeg` wide. "1" is land. */
export interface LandGrid {
  stepDeg: number;
  rows: string[];
}

// ── Entities ──────────────────────────────────────────────────────

declare module "../../app/core/plugin" {
  interface EntityKinds {
    receiver: Receiver;
    groundstation: GroundStation;
    workorder: WorkOrder;
    mapnote: MapNote;
  }
}
