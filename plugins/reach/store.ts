import { create } from "zustand";
import { go } from "../../app/core/nav";
import { profile } from "../../app/core/profile";
import type { LatLon } from "../../shared/geo";
import type { Beacon, Receiver } from "./types";

export interface NoteDraft {
  /** Null when no position is known yet; the dialog then asks for one. */
  lat: number | null;
  lon: number | null;
  text: string;
}

interface ReachStore {
  /** The receiver shown in the large tuning panel on the Reach screen. Set only by a click on "Tune in". */
  tuner: { receiver: Receiver; beacon: Beacon | null } | null;
  /** The note being written; the dialog is open while this is set. */
  draft: NoteDraft | null;
  closeTuner: () => void;
  setDraft: (draft: NoteDraft | null) => void;
}

export const useReach = create<ReachStore>((set) => ({
  tuner: null,
  draft: null,
  closeTuner: () => set({ tuner: null }),
  setDraft: (draft) => set({ draft }),
}));

/** Open the note dialog, with the position filled in when one is known. */
export function leaveNote(at: LatLon | null, text = ""): void {
  useReach.setState({ draft: { lat: at ? Number(at.lat.toFixed(5)) : null, lon: at ? Number(at.lon.toFixed(5)) : null, text } });
}

/** Open a receiver in the tuning panel. It loads the receiver's page, which asks for its own click before any audio plays. */
export function tuneIn(receiver: Receiver, beacon: Beacon | null = null): void {
  // The profiler card sits over the panel's buttons.
  profile.close();
  useReach.setState({ tuner: { receiver, beacon } });
  go("reach", { action: "tuner" });
}
