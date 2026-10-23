import type { BeaconEvent } from "./tracker";
import type { Note } from "./analysis";

/** What the analysis loop publishes to the panels, about 12 times a second. */
export interface Snapshot {
  sampleRate: number;
  /** Smoothed RMS level, dBFS. */
  rmsDb: number;
  peakHoldDb: number;
  /** Recent levels, oldest first, for the level history. */
  history: number[];
  pitch: { frequency: number; note: Note } | null;
  strongest: { frequency: number; db: number } | null;
  band: {
    /** Highest bin per slice of the beacon band, dBFS. */
    shape: number[];
    /** Highest frequency the source can carry inside the band, Hz; 0 when the band is out of reach. */
    reachHz: number;
    peakDb: number;
    peakHz: number | null;
    /** dB the strongest narrow tone stands above the band median; 0 when there is none. */
    prominence: number;
    toneNow: boolean;
  };
  beaconActive: boolean;
  beacons: BeaconEvent[];
}

export type PanelId = "level" | "tuner" | "beacons";
