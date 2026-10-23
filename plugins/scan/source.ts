import { useCallback, useEffect, useRef, useState, type RefObject, type SyntheticEvent } from "react";
import type { Frame, GetFrame, SourceKind } from "./types";

export type SourceStatus = "idle" | "starting" | "live" | "denied" | "error";

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface SourceInfo {
  kind: SourceKind;
  label: string;
}

export interface Source {
  info: SourceInfo | null;
  status: SourceStatus;
  /** What went wrong, in words the user can act on. */
  problem: string | null;
  devices: CameraDevice[];
  /** The camera in use, when the source is a camera. */
  deviceId: string | null;
  size: { width: number; height: number } | null;
  startCamera: (deviceId?: string) => Promise<void>;
  openFile: (file: File) => void;
  stop: () => void;
  getFrame: GetFrame;
  videoRef: RefObject<HTMLVideoElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  onVideoReady: (e: SyntheticEvent<HTMLVideoElement>) => void;
  onImageReady: (e: SyntheticEvent<HTMLImageElement>) => void;
  onImageError: () => void;
}

function describeCameraError(err: unknown, rearCamera: boolean): { status: SourceStatus; problem: string } {
  const name = err instanceof DOMException ? err.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return { status: "denied", problem: "Camera access was blocked." };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { status: "error", problem: rearCamera ? "No rear camera was found. Open Lens on a phone, or use the nearby list." : "No camera was found. Connect one, or open an image or video file instead." };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return { status: "error", problem: "The camera could not start. Another app may be using it. Close that app and try again." };
  }
  return { status: "error", problem: `The camera could not start${err instanceof Error ? `: ${err.message}` : ""}.` };
}

async function listCameras(): Promise<CameraDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Camera ${i + 1}` }));
}

export function useCameraList(): { devices: CameraDevice[]; refresh: () => Promise<CameraDevice[]> } {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const refresh = useCallback(async (): Promise<CameraDevice[]> => {
    const list = await listCameras();
    setDevices(list);
    return list;
  }, []);
  useEffect(() => {
    void refresh();
    const media = navigator.mediaDevices;
    media?.addEventListener("devicechange", refresh);
    return () => media?.removeEventListener("devicechange", refresh);
  }, [refresh]);
  return { devices, refresh };
}

/** Owns the one active picture source: a camera, a video file or an image file. */
export function useSource(facingMode?: "environment"): Source {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const urlRef = useRef<string | null>(null);
  const infoRef = useRef<SourceInfo | null>(null);
  const keyRef = useRef(0);

  const [info, setInfo] = useState<SourceInfo | null>(null);
  const [status, setStatus] = useState<SourceStatus>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const { devices, refresh } = useCameraList();

  const release = useCallback((): void => {
    keyRef.current += 1;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
      video.removeAttribute("src");
      video.load();
    }
    imageRef.current?.removeAttribute("src");
    infoRef.current = null;
  }, []);

  const stop = useCallback((): void => {
    release();
    setInfo(null);
    setStatus("idle");
    setProblem(null);
    setDeviceId(null);
    setSize(null);
  }, [release]);

  // Camera tracks must never outlive the screen.
  useEffect(() => release, [release]);

  const startCamera = useCallback(
    async (wanted?: string): Promise<void> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setProblem(facingMode ? "This browser cannot open a camera here. Open Lens through Phone's HTTPS link, or use the nearby list." : "This browser cannot open a camera here. Use an image or video file instead.");
        return;
      }
      release();
      const token = keyRef.current;
      setInfo(null);
      setSize(null);
      setProblem(null);
      setStatus("starting");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { ...(wanted ? { deviceId: { exact: wanted } } : facingMode ? { facingMode: { exact: facingMode } } : {}), width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (token !== keyRef.current) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const track = stream.getVideoTracks()[0];
        const settings = track?.getSettings();
        const next: SourceInfo = { kind: "camera", label: track?.label || "Camera" };
        infoRef.current = next;
        track?.addEventListener("ended", () => {
          if (token !== keyRef.current) return;
          setStatus("error");
          setProblem("The camera disconnected. Reconnect it and choose it again.");
        });
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          void video.play().catch(() => undefined);
        }
        setInfo(next);
        setDeviceId(settings?.deviceId ?? wanted ?? null);
        await refresh();
      } catch (err) {
        if (token !== keyRef.current) return;
        const { status: s, problem: p } = describeCameraError(err, facingMode !== undefined);
        setStatus(s);
        setProblem(p);
      }
    },
    [release, refresh, facingMode],
  );

  const openFile = useCallback(
    (file: File): void => {
      const kind: SourceKind | null = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : null;
      release();
      setSize(null);
      setDeviceId(null);
      if (!kind) {
        setInfo(null);
        setStatus("error");
        setProblem(`"${file.name}" is not an image or a video. Choose a PNG, JPEG, WebP, MP4 or WebM file.`);
        return;
      }
      const url = URL.createObjectURL(file);
      urlRef.current = url;
      const next: SourceInfo = { kind, label: file.name };
      infoRef.current = next;
      setInfo(next);
      setProblem(null);
      setStatus("starting");
      if (kind === "image") {
        if (imageRef.current) imageRef.current.src = url;
      } else if (videoRef.current) {
        videoRef.current.src = url;
        void videoRef.current.play().catch(() => undefined);
      }
    },
    [release],
  );

  const onVideoReady = useCallback((e: SyntheticEvent<HTMLVideoElement>): void => {
    const v = e.currentTarget;
    if (!v.videoWidth || infoRef.current?.kind === "image") return;
    setSize({ width: v.videoWidth, height: v.videoHeight });
    setStatus("live");
  }, []);

  const onImageReady = useCallback((e: SyntheticEvent<HTMLImageElement>): void => {
    const img = e.currentTarget;
    if (!img.naturalWidth) return;
    setSize({ width: img.naturalWidth, height: img.naturalHeight });
    setStatus("live");
  }, []);

  const onImageError = useCallback((): void => {
    if (infoRef.current?.kind !== "image") return;
    setStatus("error");
    setProblem("This image could not be decoded. Try a PNG or JPEG file.");
  }, []);

  const getFrame = useCallback((): Frame | null => {
    const current = infoRef.current;
    if (!current) return null;
    const key = String(keyRef.current);
    if (current.kind === "image") {
      const img = imageRef.current;
      if (!img || !img.complete || !img.naturalWidth) return null;
      return { el: img, width: img.naturalWidth, height: img.naturalHeight, kind: "image", key };
    }
    const video = videoRef.current;
    if (!video || video.readyState < 2 || !video.videoWidth) return null;
    return { el: video, width: video.videoWidth, height: video.videoHeight, kind: current.kind, key };
  }, []);

  return { info, status, problem, devices, deviceId, size, startCamera, openFile, stop, getFrame, videoRef, imageRef, onVideoReady, onImageReady, onImageError };
}
