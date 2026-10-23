import { Camera, FileVideo, Lock, Square } from "lucide-react";
import { useRef, type ReactElement } from "react";
import { Button, Empty, Tag } from "../../app/ui";
import type { Source } from "./source";

const DENIED_STEPS = [
  "Click the camera icon at the right end of the address bar and choose Allow. Then press Use camera again.",
  "If there is no icon: open System Settings, then Privacy & Security, then Camera, and switch your browser on.",
  "Still blocked? Open the file instead. Every mode works with an image or video file.",
];

/** Where the picture comes from, with the privacy promise written next to the button that needs it. */
export function SourceBar({ source }: { source: Source }): ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const { info, status, problem, devices, deviceId } = source;
  const live = info?.kind === "camera" && status === "live";
  const labelled = devices.length > 0 && devices.some((d) => !/^Camera \d+$/.test(d.label));

  return (
    <div className="scan-source">
      <div className="scan-source__row">
        <Button variant={info ? "default" : "primary"} icon={<Camera size={14} />} disabled={status === "starting"} onClick={() => void source.startCamera(deviceId ?? undefined)}>
          {live ? "Restart camera" : "Use camera"}
        </Button>
        {labelled && devices.length > 1 && (
          <label className="v-input scan-source__select">
            <span className="v-input__prompt" aria-hidden>
              ›
            </span>
            <select aria-label="Camera" value={deviceId ?? ""} onChange={(e) => void source.startCamera(e.target.value || undefined)}>
              {!deviceId && <option value="">Choose a camera</option>}
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button icon={<FileVideo size={14} />} onClick={() => fileRef.current?.click()}>
          Open image or video
        </Button>
        <input
          ref={fileRef}
          id="scan-file"
          className="sr-only"
          type="file"
          accept="image/*,video/*"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) source.openFile(file);
            e.target.value = "";
          }}
        />
        {info && (
          <Button variant="ghost" icon={<Square size={12} />} onClick={source.stop}>
            Stop
          </Button>
        )}
        <span className="scan-source__status">
          {status === "starting" && <Tag tone="ice">Opening</Tag>}
          {status === "live" && info && <Tag tone="ice">{info.kind === "camera" ? "Camera live" : info.kind === "video" ? "Playing file" : "Image loaded"}</Tag>}
          {(status === "denied" || status === "error") && <Tag tone="alarm">{status === "denied" ? "Blocked" : "Problem"}</Tag>}
        </span>
      </div>
      <p className="scan-source__privacy">
        <Lock size={12} aria-hidden />
        Frames are analysed on this Mac. Your browser asks for camera access when you press Use camera.
      </p>
      {status === "denied" && (
        <Empty title="Camera access is blocked" tone="error">
          <ol className="scan-steps">
            {DENIED_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Empty>
      )}
      {status === "error" && problem && (
        <Empty title="Source problem" tone="error">
          {problem}
        </Empty>
      )}
    </div>
  );
}
