import { useEffect, useRef, useState, type ReactElement } from "react";
import { useDocumentVisible, useScreenActive } from "../../app/core/hooks";
import type { CameraStream } from "./types";

/**
 * Live video from an operator's public stream. HLS plays natively where the browser can (Safari);
 * elsewhere hls.js is loaded on first use. The stream runs only while the element is on screen,
 * the tab is visible and the screen is shown, and every connection closes when any of that stops.
 */
export function LiveVideo({ stream, onLive }: { stream: CameraStream; onLive?: (live: boolean) => void }): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const [inView, setInView] = useState(false);
  const [live, setLive] = useState(false);
  const pageVisible = useDocumentVisible();
  const screenActive = useScreenActive();
  const run = inView && pageVisible && screenActive;
  const onLiveRef = useRef(onLive);
  onLiveRef.current = onLive;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold: 0.25 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    onLiveRef.current?.(live);
  }, [live]);

  useEffect(() => {
    if (!run) return;
    const on = (): void => setLive(true);
    const off = (): void => setLive(false);

    if (stream.type === "mjpeg") {
      const img = image.current;
      if (!img) return;
      img.addEventListener("load", on);
      img.addEventListener("error", off);
      img.src = stream.url;
      return () => {
        img.removeEventListener("load", on);
        img.removeEventListener("error", off);
        img.removeAttribute("src");
        off();
      };
    }

    const el = video.current;
    if (!el) return;
    let cancelled = false;
    let hls: { destroy: () => void } | null = null;
    el.addEventListener("playing", on);
    el.addEventListener("pause", off);
    el.addEventListener("error", off);
    if (el.canPlayType("application/vnd.apple.mpegurl")) {
      el.src = stream.url;
      void el.play().catch(off);
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        const player = new Hls();
        hls = player;
        player.loadSource(stream.url);
        player.attachMedia(el);
        player.on(Hls.Events.MANIFEST_PARSED, () => void el.play().catch(off));
        player.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          player.destroy();
          off();
        });
      });
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      el.removeEventListener("playing", on);
      el.removeEventListener("pause", off);
      el.removeEventListener("error", off);
      el.removeAttribute("src");
      el.load();
      off();
    };
  }, [run, stream.type, stream.url]);

  return (
    <div ref={box} className={`webcams-live${live ? " webcams-live--on" : ""}`}>
      {stream.type === "hls" ? <video ref={video} muted playsInline aria-label="Live video" /> : <img ref={image} alt="Live video" referrerPolicy="no-referrer" />}
    </div>
  );
}
