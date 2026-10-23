import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useMemo, useState } from "react";
import { MAP_INK } from "../city/extension";
import type { RiverStatus } from "./types";

/**
 * Map badges in the street grid's style: a dark disc, a coloured ring and a glyph, so a live thing and a mapped
 * thing read as one system. Colour carries state: mint healthy, sodium live or elevated, alarm danger, grey unknown.
 */

const CIRCUMFERENCE = 2 * Math.PI * 13.5;

const GLYPHS = {
  bridge: '<path d="M3 16.5h18M5 16.5v-3.5a7 7 0 0 1 14 0v3.5M9 10.6v5.9M15 10.6v5.9" fill="none"/>',
  park: '<text x="12" y="17" font-family="Helvetica, Arial, sans-serif" font-size="14" font-weight="700" text-anchor="middle" stroke="none">P</text>',
  bike: '<circle cx="6.5" cy="16" r="3.4" fill="none"/><circle cx="17.5" cy="16" r="3.4" fill="none"/><path d="M6.5 16l3.6-7h5.2l2.2 7M9.4 9L8 7H6M11.5 13h6" fill="none"/>',
  river: '<path d="M3 9.5c2.2-2 4.4-2 6.6 0s4.4 2 6.6 0c1.6-1.4 3.2-1.8 4.8-.8M3 15c2.2-2 4.4-2 6.6 0s4.4 2 6.6 0c1.6-1.4 3.2-1.8 4.8-.8" fill="none"/>',
} as const;

function badge(ink: string, glyph: keyof typeof GLYPHS, arc?: { fraction: number; ink: string }): string {
  const ring = arc
    ? `<circle cx="16" cy="16" r="13.5" fill="${MAP_INK.void}" fill-opacity="0.92" stroke="${MAP_INK.ash}" stroke-width="1.2" stroke-opacity="0.7"/><circle cx="16" cy="16" r="13.5" fill="none" stroke="${arc.ink}" stroke-width="2.6" stroke-linecap="butt" stroke-dasharray="${(Math.max(0, Math.min(1, arc.fraction)) * CIRCUMFERENCE).toFixed(2)} ${CIRCUMFERENCE.toFixed(2)}" transform="rotate(-90 16 16)"/>`
    : `<circle cx="16" cy="16" r="13.5" fill="${MAP_INK.void}" fill-opacity="0.92" stroke="${ink}" stroke-width="1.6"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${ring}<g transform="translate(5.6 5.6) scale(0.87)" fill="${ink}" stroke="${ink}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[glyph]}</g></svg>`;
}

export interface BadgeSpec {
  name: string;
  svg: string;
}

export const BRIDGE_BADGES: BadgeSpec[] = [
  { name: "pulse-bridge-idle", svg: badge(MAP_INK.fog, "bridge") },
  { name: "pulse-bridge-open", svg: badge(MAP_INK.sodium, "bridge") },
];

export const BIKE_BADGES: BadgeSpec[] = [
  { name: "pulse-bike-live", svg: badge(MAP_INK.sodium, "bike") },
  { name: "pulse-bike-latest", svg: badge(MAP_INK.fog, "bike") },
];

const RIVER_INK: Record<RiverStatus, string> = { normal: MAP_INK.mint, elevated: MAP_INK.sodium, high: MAP_INK.alarm, unknown: MAP_INK.fog };
export const RIVER_BADGES: BadgeSpec[] = (Object.keys(RIVER_INK) as RiverStatus[]).map((s) => ({ name: `pulse-river-${s}`, svg: badge(RIVER_INK[s], "river") }));

/** Fill steps of the parking gauge: the ring shows how full a car park is, in tenths. */
export const PARK_STEPS = 10;
export type ParkTone = "mint" | "sodium" | "alarm" | "closed";
const PARK_INK: Record<ParkTone, string> = { mint: MAP_INK.mint, sodium: MAP_INK.sodium, alarm: MAP_INK.alarm, closed: MAP_INK.ash };

export const PARK_BADGES: BadgeSpec[] = (Object.keys(PARK_INK) as ParkTone[]).flatMap((tone) =>
  Array.from({ length: PARK_STEPS + 1 }, (_, step) => ({ name: `pulse-park-${tone}-${step}`, svg: badge(PARK_INK[tone], "park", { fraction: step / PARK_STEPS, ink: PARK_INK[tone] }) })),
);

export const parkIcon = (tone: ParkTone, occupied: number): string => `pulse-park-${tone}-${Math.round(Math.max(0, Math.min(1, occupied)) * PARK_STEPS)}`;

export const riverIcon = (status: RiverStatus): string => `pulse-river-${status}`;

/** Add each badge to the map once, as a full-colour image. True when all are ready to draw. */
export function useBadges(map: MapLibreMap, specs: readonly BadgeSpec[]): boolean {
  const [done, setDone] = useState(0);
  const key = useMemo(() => specs.map((s) => s.name).join(","), [specs]);
  useEffect(() => {
    let alive = true;
    let finished = 0;
    const finish = (): void => {
      finished++;
      if (alive && finished === specs.length) setDone(specs.length);
    };
    for (const spec of specs) {
      if (map.hasImage(spec.name)) {
        finish();
        continue;
      }
      const img = new Image(64, 64);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext("2d");
        if (ctx && alive && map.style && !map.hasImage(spec.name)) {
          ctx.drawImage(img, 0, 0, 64, 64);
          map.addImage(spec.name, ctx.getImageData(0, 0, 64, 64), { pixelRatio: 2 });
        }
        finish();
      };
      img.onerror = finish;
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(spec.svg)}`;
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, key]);
  return done === specs.length;
}
