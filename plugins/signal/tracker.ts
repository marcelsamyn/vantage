import type { Tone } from "./analysis";

export interface BeaconEvent {
  id: number;
  /** Wall-clock time (`Date.now()`) when the tone first appeared, for display. */
  startedAt: number;
  /** Mean frequency of the tone, Hz. */
  frequency: number;
  durationMs: number;
  peakDb: number;
  ongoing: boolean;
}

interface Track {
  id: number;
  /** Frame time when the tone first appeared; durations come from this clock. */
  startedFrame: number;
  startedAt: number;
  lastSeen: number;
  frequency: number;
  peakDb: number;
  confirmed: boolean;
}

/** A tone must last this long to count as beacon-like. Speech and music do not hold one narrow frequency that long. */
export const CONFIRM_MS = 1500;
/** A tone that drifts by less than this is the same tone. */
const SAME_TONE_HZ = 120;
/** Frames can miss a faint tone now and then; a gap shorter than this does not end it. */
const GAP_MS = 350;
const MAX_EVENTS = 40;

/** Follows narrow tones from frame to frame and reports the ones that persist. */
export class BeaconTracker {
  private tracks: Track[] = [];
  private events: BeaconEvent[] = [];
  private nextId = 1;

  /** Feed one frame's tones. Returns the events that just reached the persistence threshold. */
  update(now: number, tones: readonly Tone[]): BeaconEvent[] {
    for (const tone of tones) {
      const track = this.tracks.find((t) => Math.abs(t.frequency - tone.frequency) <= SAME_TONE_HZ);
      if (track) {
        track.frequency += (tone.frequency - track.frequency) * 0.1;
        track.lastSeen = now;
        track.peakDb = Math.max(track.peakDb, tone.db);
      } else {
        this.tracks.push({ id: this.nextId++, startedFrame: now, startedAt: Date.now(), lastSeen: now, frequency: tone.frequency, peakDb: tone.db, confirmed: false });
      }
    }

    const confirmed: BeaconEvent[] = [];
    for (const track of this.tracks) {
      const ongoing = now - track.lastSeen <= GAP_MS;
      const duration = track.lastSeen - track.startedFrame;
      if (!track.confirmed && duration >= CONFIRM_MS) {
        track.confirmed = true;
        const event: BeaconEvent = { id: track.id, startedAt: track.startedAt, frequency: track.frequency, durationMs: duration, peakDb: track.peakDb, ongoing };
        this.events = [event, ...this.events].slice(0, MAX_EVENTS);
        confirmed.push(event);
      }
      const event = this.events.find((e) => e.id === track.id);
      if (event) Object.assign(event, { frequency: track.frequency, durationMs: duration, peakDb: track.peakDb, ongoing });
    }
    this.tracks = this.tracks.filter((track) => now - track.lastSeen <= GAP_MS);
    return confirmed;
  }

  /** Confirmed detections, newest first. A fresh array each call, so React sees a change. */
  log(): BeaconEvent[] {
    return this.events.map((e) => ({ ...e }));
  }

  /** True while a confirmed tone is still sounding. */
  get active(): boolean {
    return this.tracks.some((t) => t.confirmed);
  }

  clear(): void {
    this.tracks = [];
    this.events = [];
  }
}
