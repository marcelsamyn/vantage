/** Payloads served by /api/listen. Shared by api.ts (server) and the browser code. */

// ── Open microphones ──────────────────────────────────────────────

/** Who runs the microphone. Both publish their streams for the public, on purpose. */
export type MicSource = "locustream" | "orcasound";

/** How the browser plays it: a plain audio stream, or an HLS playlist (Orcasound's hydrophones). */
export type MicFormat = "mp3" | "ogg" | "hls";

export interface Microphone {
  /** Stable id such as `ls-563` or `oc-sunset-bay`. The stream relay only plays ids it finds in its own list. */
  id: string;
  source: MicSource;
  /** The spot, such as "Rue de la Poudrière". */
  name: string;
  /** The town or area, such as "Bruxelles". */
  place: string;
  country: string | null;
  lat: number;
  lon: number;
  /** IANA zone of the place; null when the lookup service did not answer. */
  timezone: string | null;
  format: MicFormat;
  /**
   * The stream address, which the browser tries first so the audio does not pass through this server.
   * When the stream lacks the cross-origin headers that Web Audio needs, playback falls back to `/api/listen/stream/<id>`.
   * Null for HLS microphones, whose playlist address is looked up at play time.
   */
  stream: string | null;
  /** False for a hydrophone whose playlist has not been updated for several minutes. */
  live: boolean;
  /** The project's own page for this microphone or map. */
  homepage: string;
}

export interface Microphones {
  microphones: Microphone[];
  /** Credits shown beside the map. */
  sources: { id: MicSource; name: string; url: string; licence: string }[];
}

/** Where to play an HLS microphone right now. The playlist folder changes whenever the hydrophone restarts. */
export interface HlsPlaylist {
  url: string;
}

// ── Birds ─────────────────────────────────────────────────────────

export type BirdWindow = "hour" | "day";

export interface BirdClip {
  /** Opaque handle: play it from `/api/listen/birds/clip/<key>`. The file name behind it holds a station id, so it stays on the server. */
  key: string;
  /** Seconds into the file where the detected call starts and ends. */
  startS: number;
  endS: number;
  /** When the call was heard, in epoch ms. */
  at: number;
  /** The listening station that recorded the call: id, name and exact position; null when the clip query returned no station. */
  station: { id: string; name: string; lat: number; lon: number } | null;
}

export interface BirdSpecies {
  id: string;
  commonName: string;
  scientificName: string;
  /** Detections in the window, across every listening station in the area. */
  count: number;
  /** Mean certainty (0 to 1) the detector reported for this species' latest calls; null when none were read. */
  certainty: number | null;
  /** The surest recent call that has a public clip. */
  clip: BirdClip | null;
}

export interface BirdsNear {
  window: BirdWindow;
  /** Centre of the search area, rounded to a 0.1° grid (about 11 km) so no exact position is kept or sent. */
  area: { lat: number; lon: number; radiusKm: number };
  detections: number;
  species: number;
  stations: number;
  top: BirdSpecies[];
  /** Detections for each hour of the day (index 0 = 00:00), over the last 24 hours, in each station's local time. */
  hours: number[];
  /** When this answer was assembled, in epoch ms. */
  at: number;
}

// ── Meteors ───────────────────────────────────────────────────────

export interface MeteorPoint {
  lat: number;
  lon: number;
  /** Height above the ground in km. */
  heightKm: number;
}

/** One meteor seen by two or more cameras of the Global Meteor Network. */
export interface Meteor {
  id: string;
  /** When it first lit up, in epoch ms (UTC). */
  at: number;
  /** IAU shower code; null for a sporadic meteor that belongs to no shower. */
  shower: string | null;
  showerName: string | null;
  begin: MeteorPoint;
  end: MeteorPoint;
  /** Speed when first seen, in km/s. */
  speedKms: number;
  durationS: number;
  /** Brightest absolute magnitude (as it would look from 100 km away); lower is brighter. */
  peakMag: number;
  massKg: number;
  /** How many cameras saw it. */
  cameras: number;
  /** True when it began over Europe (35°N to 72°N, 25°W to 45°E). */
  europe: boolean;
}

export interface MeteorShowerCount {
  code: string;
  name: string;
  count: number;
}

export type MeteorArea = "europe" | "world";

export interface MeteorNight {
  /** First and last meteor in the file, in epoch ms. */
  from: number;
  to: number;
  /** All trajectories in the file, and how many began over Europe. */
  total: number;
  europe: number;
  /** Showers in the requested area, most meteors first. */
  showers: MeteorShowerCount[];
  /** Meteors in the requested area, oldest first. */
  meteors: Meteor[];
  /** The brightest and the fastest meteor in the requested area. */
  brightest: Meteor | null;
  fastest: Meteor | null;
}

/** What `GET /meteors/:id` adds to a meteor when someone opens its profile. */
export interface MeteorDetail {
  id: string;
  /** Camera station codes of the Global Meteor Network that recorded it. */
  stations: string[];
  /** The nearest named place under where it began, or null over open sea. */
  over: string | null;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    meteor: Meteor;
  }
}
