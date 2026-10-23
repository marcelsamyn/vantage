import { directionBearing } from "./direction";
import { webUrl } from "../../server/kit";
import type { CameraKind, CameraStream, Webcam } from "./types";

/** Sent to operators that ask who is calling. */
export const USER_AGENT = "VANTAGE/1.0 (personal dashboard; local)";

/** What every camera of one operator has in common. */
export interface Operator {
  provider: string;
  providerName: string;
  kind: CameraKind;
  license: string;
  refreshS: number;
  tz?: string | null;
}

export interface CameraFields {
  id: string;
  name: string;
  lat: number;
  lon: number;
  image: string;
  refreshS?: number;
  video?: string | null;
  stream?: CameraStream | null;
  direction?: string | null;
  bearing?: number | null;
  kind?: CameraKind;
  tz?: string | null;
  frames?: number;
  capturedAt?: number | null;
  page?: string | null;
}

/**
 * Build a camera from operator defaults and per-camera fields.
 * Returns an empty list for a record without usable coordinates or a valid http(s) picture address, so loaders can
 * `flatMap` over raw rows. Operator addresses end up in `src` and `href`, so each one passes `webUrl`.
 */
export function webcam(op: Operator, c: CameraFields): Webcam[] {
  if (!Number.isFinite(c.lat) || !Number.isFinite(c.lon) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) return [];
  if (c.lat === 0 && c.lon === 0) return [];
  const image = webUrl(c.image);
  if (!image) return [];
  const stream = c.stream && webUrl(c.stream.url) ? c.stream : null;
  return [
    {
      id: `${op.provider}:${c.id}`,
      provider: op.provider,
      providerName: op.providerName,
      kind: c.kind ?? op.kind,
      name: c.name.trim(),
      lat: c.lat,
      lon: c.lon,
      image,
      video: webUrl(c.video),
      stream,
      direction: c.direction?.trim() || null,
      bearing: c.bearing ?? directionBearing(c.direction),
      refreshS: c.refreshS ?? op.refreshS,
      license: op.license,
      page: webUrl(c.page),
      tz: c.tz ?? op.tz ?? null,
      frames: c.frames ?? 1,
      capturedAt: c.capturedAt ?? null,
    },
  ];
}

export const DAY = 24 * 3_600_000;
