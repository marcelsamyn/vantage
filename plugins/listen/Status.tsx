import { Square } from "lucide-react";
import type { ReactElement } from "react";
import { go } from "../../app/core/nav";
import { LiveDot } from "../../app/ui";
import { stopMic, usePlayer } from "./audio";
import "./listen.css";

/** A small item in the status bar while a microphone is open, so you can leave the screen and keep listening. */
export default function ListenStatus(): ReactElement | null {
  const mic = usePlayer((s) => s.mic);
  const phase = usePlayer((s) => s.phase);
  if (!mic || (phase !== "playing" && phase !== "connecting")) return null;
  return (
    <div className="v-status-item listen-mini">
      <LiveDot tone="sodium" live={phase === "playing"} />
      <button type="button" className="listen-mini__name" onClick={() => go("listen")} title="Open Listen">
        {mic.place}
      </button>
      <button type="button" className="listen-mini__stop" onClick={stopMic} aria-label={`Stop listening to ${mic.place}`} title="Stop">
        <Square size={11} fill="currentColor" />
      </button>
    </div>
  );
}
