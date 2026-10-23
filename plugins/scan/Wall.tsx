import { motion } from "motion/react";
import { Camera, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { useHotkey, useNow } from "../../app/core/hooks";
import { Button, Empty, LiveDot, Panel } from "../../app/ui";
import { useCameraList, type CameraDevice } from "./source";

interface Feed {
  device: CameraDevice;
  stream: MediaStream;
}

/** Opens every camera at once. Streams belong to this component and stop when it unmounts. */
function useWall(): { feeds: Feed[]; opening: boolean; problem: string | null; open: () => Promise<void>; close: () => void } {
  const { refresh } = useCameraList();
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const alive = useRef(true);

  const close = useCallback((): void => {
    streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streams.current = [];
    setFeeds([]);
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      streams.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      streams.current = [];
    };
  }, []);

  const open = useCallback(async (): Promise<void> => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem("This browser cannot open cameras here.");
      return;
    }
    close();
    setOpening(true);
    setProblem(null);
    try {
      // One request first: browsers only show camera names after permission is granted.
      const probe = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      probe.getTracks().forEach((t) => t.stop());
      const list = await refresh();
      const opened = await Promise.allSettled(
        list.map(async (device): Promise<Feed> => ({ device, stream: await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: device.deviceId } }, audio: false }) })),
      );
      const ok = opened.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
      if (!alive.current) {
        ok.forEach((f) => f.stream.getTracks().forEach((t) => t.stop()));
        return;
      }
      streams.current = ok.map((f) => f.stream);
      setFeeds(ok);
      if (ok.length === 0) setProblem("No camera could be opened. Another app may be using them.");
      else if (ok.length < list.length) setProblem(`${list.length - ok.length} camera(s) could not be opened and are left out.`);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setProblem(
        name === "NotAllowedError" || name === "SecurityError"
          ? "Camera access is blocked. Click the camera icon in the address bar and choose Allow, or open System Settings, Privacy & Security, Camera."
          : name === "NotFoundError"
            ? "No camera was found. Connect one and try again."
            : "The cameras could not start. Close other apps that use the camera and try again.",
      );
    } finally {
      if (alive.current) setOpening(false);
    }
  }, [close, refresh]);

  return { feeds, opening, problem, open, close };
}

/** Small tiled noise texture, drawn once, so each feed can look like a CCTV monitor. */
let noiseUrl: string | null = null;
function noise(): string {
  if (noiseUrl) return noiseUrl;
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const image = ctx.createImageData(96, 96);
  for (let i = 0; i < image.data.length; i += 4) {
    const v = Math.random() * 255;
    image.data[i] = v;
    image.data[i + 1] = v;
    image.data[i + 2] = v;
    image.data[i + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
  noiseUrl = canvas.toDataURL("image/png");
  return noiseUrl;
}

function stamp(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function WallTile({ feed, index, big, onPick }: { feed: Feed; index: number; big: boolean; onPick: () => void }): ReactElement {
  const ref = useRef<HTMLVideoElement>(null);
  const now = useNow(1000);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    video.srcObject = feed.stream;
    void video.play().catch(() => undefined);
  }, [feed.stream]);

  return (
    <motion.button
      type="button"
      className={`scan-cam${big ? " scan-cam--big" : ""}`}
      onClick={onPick}
      aria-label={big ? `Shrink ${feed.device.label}` : `Enlarge ${feed.device.label}`}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", duration: 0.45, bounce: 0, delay: index * 0.06 }}
    >
      <video ref={ref} className="scan-cam__video" muted playsInline />
      <span className="scan-cam__noise" style={{ backgroundImage: `url(${noise()})` }} aria-hidden />
      <span className="scan-cam__lines" aria-hidden />
      <span className="scan-cam__top">
        <span className="scan-cam__id num">CAM {String(index + 1).padStart(2, "0")}</span>
        <span className="scan-cam__rec">
          <LiveDot tone="alarm" />
          REC
        </span>
      </span>
      <span className="scan-cam__bottom">
        <span className="scan-cam__label">{feed.device.label}</span>
        <span className="scan-cam__time num">{stamp(now)}</span>
      </span>
    </motion.button>
  );
}

export function Wall({ filePicture }: { filePicture: boolean }): ReactElement {
  const wall = useWall();
  const [focus, setFocus] = useState<string | null>(null);
  useHotkey((e) => e.key === "Escape", () => setFocus(null));

  if (wall.feeds.length === 0) {
    return (
      <Panel title="Camera wall">
        <Empty
          title={wall.opening ? "Opening cameras" : "Watch every camera at once"}
          action={
            <Button variant="primary" icon={<Camera size={14} />} disabled={wall.opening} onClick={() => void wall.open()}>
              Open all cameras
            </Button>
          }
        >
          <p>
            Each camera on or connected to this Mac opens in a grid. Your browser asks for camera access when you press the button.
          </p>
          {filePicture && <p>The wall shows live cameras only. Your image or video file stays in the other modes.</p>}
          {wall.problem && <p className="alarm">{wall.problem}</p>}
        </Empty>
      </Panel>
    );
  }

  const focused = wall.feeds.find((f) => f.device.deviceId === focus) ?? null;
  const rest = wall.feeds.filter((f) => f !== focused);
  return (
    <Panel
      title={`Camera wall · ${wall.feeds.length} ${wall.feeds.length === 1 ? "camera" : "cameras"}`}
      actions={
        <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={wall.close}>
          Close cameras
        </Button>
      }
      flush
    >
      <div className="scan-wall">
        {focused && <WallTile key={`big-${focused.device.deviceId}`} feed={focused} index={wall.feeds.indexOf(focused)} big onPick={() => setFocus(null)} />}
        <div className={`scan-wall__grid${focused ? " scan-wall__grid--strip" : ""}`}>
          {rest.map((feed) => (
            <WallTile key={feed.device.deviceId} feed={feed} index={wall.feeds.indexOf(feed)} big={false} onPick={() => setFocus(feed.device.deviceId)} />
          ))}
        </div>
      </div>
      {wall.problem && <p className="scan-note scan-wall__note">{wall.problem}</p>}
    </Panel>
  );
}
