import { mark } from "../ui/glyphs";

/** --void and --ice from app/styles/tokens.css. */
const VOID = "#05070a";
const ICE = "#82e4ff";

/** The VANTAGE mark on the app background, centred, a third of the short side wide. Null without a 2D canvas. */
function draw(width: number, height: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const unit = Math.min(width, height) / 3 / 24;
  ctx.fillStyle = VOID;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, 24 * unit);
  glow.addColorStop(0, `${ICE}29`);
  glow.addColorStop(1, `${ICE}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  // The mark spans 1.5–22.5 across and 1.5–19.5 down its 24 px grid.
  ctx.translate(width / 2 - 12 * unit, height / 2 - 10.5 * unit);
  ctx.scale(unit, unit);
  ctx.strokeStyle = ICE;
  ctx.lineWidth = 1.75;
  ctx.lineCap = "square";
  ctx.lineJoin = "miter";
  // A soft bloom under a crisp stroke, as on the home-screen icon.
  ctx.shadowColor = ICE;
  ctx.shadowBlur = 1.4 * unit;
  ctx.globalAlpha = 0.55;
  for (const m of mark) ctx.stroke(new Path2D(m.d));
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
  for (const m of mark) ctx.stroke(new Path2D(m.d));
  return canvas.toDataURL("image/png");
}

/**
 * iOS ignores the manifest's background colour: a home-screen app starts on a blank screen unless the page names a
 * launch image whose pixel size matches the device exactly. Rather than keep a table of every iPhone and iPad, draw
 * the image for this device, in both orientations. iOS keeps the image it finds when the app is added to the home
 * screen, so the work is skipped once VANTAGE runs from there.
 */
export function addLaunchScreens(): void {
  // Only iOS Safari has navigator.standalone.
  if (!("standalone" in navigator) || navigator.standalone === true) return;
  // `screen` and the device-width query both describe the device in portrait, whichever way it is held.
  const short = Math.min(screen.width, screen.height);
  const long = Math.max(screen.width, screen.height);
  const ratio = devicePixelRatio;
  for (const orientation of ["portrait", "landscape"] as const) {
    const [w, h] = orientation === "portrait" ? [short, long] : [long, short];
    const href = draw(w * ratio, h * ratio);
    if (!href) return;
    const link = document.createElement("link");
    link.rel = "apple-touch-startup-image";
    link.media = `(device-width: ${short}px) and (device-height: ${long}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation})`;
    link.href = href;
    document.head.append(link);
  }
}
