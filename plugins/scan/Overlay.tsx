import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactElement } from "react";
import { useAnimationFrame } from "../../app/core/hooks";

export type DrawFn = (ctx: CanvasRenderingContext2D, width: number, height: number, now: number, dt: number) => void;

/**
 * A canvas that covers the picture. It draws in CSS pixels at the screen's pixel density and redraws every
 * animation frame while a picture is shown (`active`): what it draws follows the picture, so it is live data.
 */
export function OverlayCanvas({ draw, onPick, label, active }: { draw: DrawFn; /** Receives the click position and the canvas width, in CSS pixels. */
  onPick?: (x: number, y: number, width: number) => void; label: string; active: boolean }): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = (): void => {
      const dpr = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      sizeRef.current = { w: width, h: height, dpr };
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Track and lock stamps come from `performance.now()`, so the draw gets the frame's timestamp, not the loop's clock.
  useAnimationFrame((dt, _clock, now) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { w, h, dpr } = sizeRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, now, dt);
  }, active, "data");

  // Without a picture nothing is drawn: clear what the last frame left.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!active && canvas) canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  }, [active]);

  const pick = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (!onPick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onPick(e.clientX - rect.left, e.clientY - rect.top, rect.width);
  };

  return <canvas ref={canvasRef} className={onPick ? "scan-overlay scan-overlay--pick" : "scan-overlay"} role="img" aria-label={label} onPointerDown={pick} />;
}
