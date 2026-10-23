import { Mic } from "lucide-react";
import type { ReactElement } from "react";
import { Button, Empty, Scanning } from "../../app/ui";
import type { SourceState } from "./source";

/** What the plot area says until a source is running: why it needs access, and what to press. */
export function Prompt({ state, onMic, onChooseFile }: { state: SourceState; onMic: () => void; onChooseFile: () => void }): ReactElement | null {
  if (state.status === "live") return null;
  return (
    <div className="signal-prompt">
      {state.status === "asking" ? (
        <Scanning label="Waiting for permission" />
      ) : state.kind === "mic" ? (
        <Empty
          center
          tone={state.status === "idle" ? undefined : "error"}
          title={state.status === "idle" ? "Listen with the microphone" : state.status === "blocked" ? "Microphone blocked" : "Microphone unavailable"}
          action={
            <Button variant="primary" icon={<Mic size={14} />} onClick={onMic}>
              {state.status === "idle" ? "Allow microphone" : "Try again"}
            </Button>
          }
        >
          {state.message ??
            "Signal shows the sound around you as a live spectrum, loudness, pitch and ultrasonic tones. Audio is analysed inside this browser and is never recorded or sent anywhere. Echo cancellation, noise suppression and automatic gain are switched off so the readings are true, and your browser will ask for permission next."}
        </Empty>
      ) : (
        <Empty
          center
          tone={state.status === "error" ? "error" : undefined}
          title={state.status === "error" ? "File not readable" : "Analyse an audio file"}
          action={
            <Button variant="primary" onClick={onChooseFile}>
              Choose audio file
            </Button>
          }
        >
          {state.message ?? "The file is analysed on this device and played so you can hear what you see. It is not uploaded."}
        </Empty>
      )}
    </div>
  );
}
