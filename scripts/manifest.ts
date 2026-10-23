/**
 * Web app manifest generator.
 *
 *   bun scripts/manifest.ts
 *
 * Writes app/manifest.gen.json, which index.html links, so a phone can install VANTAGE as a home-screen app. The
 * bundler serves the manifest under a hashed name but leaves the paths inside it alone, so everything it names sits in
 * app/icons/ or app/screenshots/, which the server serves at fixed URLs. Its shortcuts (a long press on the icon) are
 * the phone tab bar's screens; their icons are drawn from the screens' rail glyphs into app/icons/shortcut-<id>.gen.png.
 *
 * It runs after `bun install`, as part of `bun run check`, and before scripts/dev.ts starts each server.
 */
import { Resvg } from "@resvg/resvg-js";
import { join, resolve } from "node:path";
import type { Plugin } from "../app/core/plugin";
import { TABS } from "../app/shell/tabs";
import type { Glyph } from "../app/ui/glyphs";
import { writeRegistry } from "./registry";

const ROOT = resolve(import.meta.dir, "..");
const APP = join(ROOT, "app");
/** --void and --ice from app/styles/tokens.css. */
const VOID = "#05070a";
const ICE = "#82e4ff";
const SHORTCUT_PX = 192;

/** Phone screenshots for Android's install sheet, all at one size: the sheet shows them side by side. */
const SCREENSHOTS = [
  { file: "around.png", label: "Around me: what is near you, on a live map" },
  { file: "sky.png", label: "Sky: aircraft, satellites, Sun, Moon and stars above you" },
  { file: "briefing.png", label: "Briefing: everything around you, at a glance" },
] as const;

/** Width and height from a PNG's IHDR chunk, so the manifest states the size the file has. */
function pngSize(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

/** A rail glyph on the VANTAGE background. The glyph fills the middle 60 %, so a launcher's round crop keeps it whole. */
function shortcutIcon(glyph: Glyph): Uint8Array {
  const marks = glyph
    .map((m) => {
      const paint = m.fill ? ` fill="${ICE}" stroke="none"` : "";
      return "d" in m ? `<path d="${m.d}"${paint}/>` : `<circle cx="${m.circle[0]}" cy="${m.circle[1]}" r="${m.circle[2]}"${paint}/>`;
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 40 40"><rect x="-8" y="-8" width="40" height="40" fill="${VOID}"/><g fill="none" stroke="${ICE}" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter">${marks}</g></svg>`;
  return new Resvg(svg, { fitTo: { mode: "width", value: SHORTCUT_PX } }).render().asPng();
}

/** Write `bytes` only when they differ: `bun run start` rebuilds on any change under app/. */
async function writeIfChanged(path: string, bytes: Uint8Array | string): Promise<void> {
  const file = Bun.file(path);
  const next = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  if ((await file.exists()) && Buffer.from(await file.bytes()).equals(next)) return;
  await Bun.write(path, next);
}

export async function writeManifest(): Promise<void> {
  // The registry is imported after it is written, so the shortcuts see this build's plugins.
  await writeRegistry();
  const { plugins } = await import("../plugins");
  const all: readonly Plugin[] = plugins;

  const shortcuts = [];
  for (const id of TABS) {
    const screen = all.find((p) => p.id === id)?.contributes.screen;
    if (!screen) continue;
    const file = `shortcut-${id}.gen.png`;
    await writeIfChanged(join(APP, "icons", file), shortcutIcon(screen.glyph));
    shortcuts.push({ name: screen.title, description: screen.summary, url: `/#/${id}`, icons: [{ src: `/icons/${file}`, sizes: `${SHORTCUT_PX}x${SHORTCUT_PX}`, type: "image/png" }] });
  }

  const screenshots = [];
  for (const { file, label } of SCREENSHOTS) {
    const bytes = await Bun.file(join(APP, "screenshots", file)).bytes();
    screenshots.push({ src: `/screenshots/${file}`, sizes: pngSize(bytes), type: "image/png", form_factor: "narrow", label });
  }

  const manifest = {
    id: "/",
    name: "VANTAGE",
    short_name: "VANTAGE",
    description: "Everything is connected.",
    lang: "en",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: VOID,
    theme_color: VOID,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts,
    screenshots,
  };
  await writeIfChanged(join(APP, "manifest.gen.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (import.meta.main) {
  await writeManifest();
  console.log("Web app manifest up to date");
}
