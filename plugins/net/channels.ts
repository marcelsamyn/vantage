import type { WifiBand, WifiNetwork } from "./types";

/**
 * Wi-Fi channel geometry. Each band has a layout that places channels on an x axis (in "units") and maps a
 * network's primary channel and width to the span it occupies. 2.4 GHz channels overlap, so they sit on a
 * continuous scale (one unit = 5 MHz). 5 and 6 GHz channels are 20 MHz slots, grouped in aligned blocks for
 * 40, 80 and 160 MHz widths.
 */

export interface Tick {
  channel: number;
  x: number;
}

export interface BandLayout {
  band: WifiBand;
  domain: readonly [number, number];
  ticks: Tick[];
  /** x range a network occupies, in layout units. */
  span: (channel: number, widthMhz: number) => readonly [number, number];
  /** Frequency range in MHz that a network occupies. */
  freq: (channel: number, widthMhz: number) => readonly [number, number];
  /** Primary channels worth recommending at this width. */
  candidates: (widthMhz: number) => number[];
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let c = from; c <= to; c += step) out.push(c);
  return out;
};

const LAYOUT_24: BandLayout = {
  band: "2.4",
  domain: [-1, 15],
  ticks: range(1, 13, 1).map((channel) => ({ channel, x: channel })),
  span: (c, w) => {
    const half = w >= 40 ? 4 : 2;
    return [c - half, c + half];
  },
  freq: (c, w) => {
    const center = 2407 + 5 * c;
    return [center - w / 2, center + w / 2];
  },
  // Channels 1, 6 and 11 are the only ones that do not overlap each other.
  candidates: () => [1, 6, 11],
};

/** Layout for bands made of 20 MHz slots. `segments` are runs of consecutive channels; gaps separate runs. */
function slotted(band: WifiBand, segments: number[][], baseMhz: number): BandLayout {
  const GAP = 0.6;
  const start: number[] = [];
  let cursor = 0;
  for (const seg of segments) {
    start.push(cursor);
    cursor += seg.length + GAP;
  }
  const locate = (channel: number): { seg: number; index: number } | null => {
    for (const [seg, channels] of segments.entries()) {
      const index = channels.indexOf(channel);
      if (index >= 0) return { seg, index };
    }
    return null;
  };
  /** The aligned block of `n` slots that holds a primary channel. */
  const block = (channel: number, widthMhz: number): { seg: number; first: number; count: number } | null => {
    const at = locate(channel);
    if (!at) return null;
    const len = segments[at.seg]?.length ?? 1;
    const wanted = Math.max(1, Math.round(widthMhz / 20));
    const count = Math.min(wanted, len);
    const first = Math.min(Math.floor(at.index / count) * count, len - count);
    return { seg: at.seg, first, count };
  };
  return {
    band,
    domain: [-0.3, cursor - GAP + 0.3],
    ticks: segments.flatMap((seg, s) => seg.map((channel, i) => ({ channel, x: (start[s] ?? 0) + i + 0.5 }))),
    span: (channel, widthMhz) => {
      const b = block(channel, widthMhz);
      if (!b) return [0, 0];
      const x0 = (start[b.seg] ?? 0) + b.first;
      return [x0, x0 + b.count];
    },
    freq: (channel, widthMhz) => {
      const b = block(channel, widthMhz);
      const seg = b ? segments[b.seg] : undefined;
      const lo = seg?.[b?.first ?? 0] ?? channel;
      const hi = seg?.[(b?.first ?? 0) + (b?.count ?? 1) - 1] ?? channel;
      return [baseMhz + 5 * lo - 10, baseMhz + 5 * hi + 10];
    },
    candidates: (widthMhz) => {
      const out: number[] = [];
      for (const seg of segments) {
        const count = Math.min(Math.max(1, Math.round(widthMhz / 20)), seg.length);
        for (let i = 0; i + count <= seg.length; i += count) out.push(seg[i] ?? 0);
      }
      return out;
    },
  };
}

const LAYOUT_5 = slotted("5", [range(36, 64, 4), range(100, 144, 4), range(149, 165, 4)], 5000);
const LAYOUT_6 = slotted("6", [range(1, 233, 4)], 5950);

export const LAYOUTS: Record<WifiBand, BandLayout> = { "2.4": LAYOUT_24, "5": LAYOUT_5, "6": LAYOUT_6 };
export const BAND_ORDER: readonly WifiBand[] = ["2.4", "5", "6"];

/** Signal to hump height, 0 to 1. -90 dBm is the floor and -30 dBm the ceiling. */
export const strength = (dbm: number): number => Math.max(0.08, Math.min(1, (dbm + 90) / 60));

/** How much a neighbour hurts, 0 to 1. Networks without a reading count as a middling -75 dBm. */
const nuisance = (dbm: number | null): number => Math.max(0.08, Math.min(1, ((dbm ?? -75) + 95) / 55)) ** 2;

export interface Recommendation {
  band: WifiBand;
  channel: number;
  /** Frequency span of the recommended block, in layout units. */
  span: readonly [number, number];
  widthMhz: number;
  /** Networks overlapping the recommended channel. */
  overlapping: number;
  /** Networks overlapping the channel in use, or null when this band is not the one in use. */
  currentOverlapping: number | null;
  /** True when the channel in use is as quiet as the best choice. */
  currentIsBest: boolean;
}

function overlapMhz(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
}

/** Pick the quietest channel in a band from how much of each neighbour's spectrum overlaps it, weighted by signal. */
export function recommend(band: WifiBand, others: WifiNetwork[], current: WifiNetwork | null): Recommendation | null {
  const layout = LAYOUTS[band];
  const mine = current && current.band === band ? current : null;
  const width = mine?.widthMhz ?? (band === "2.4" ? 20 : 80);
  const neighbours = others.filter((n) => n.band === band);
  const cost = (channel: number): { score: number; count: number } => {
    const ours = layout.freq(channel, width);
    let score = 0;
    let count = 0;
    for (const n of neighbours) {
      const share = overlapMhz(ours, layout.freq(n.channel, n.widthMhz)) / (ours[1] - ours[0]);
      if (share <= 0) continue;
      score += nuisance(n.signalDbm) * share;
      count++;
    }
    return { score, count };
  };

  const candidates = layout.candidates(width);
  if (candidates.length === 0) return null;
  const ranked = candidates.map((channel) => ({ channel, ...cost(channel) })).sort((a, b) => a.score - b.score || a.channel - b.channel);
  const best = ranked[0];
  if (!best) return null;
  const now = mine ? cost(mine.channel) : null;
  const currentIsBest = now !== null && now.score <= best.score + 0.02;
  // When the channel in use is as quiet as the best, recommend keeping it instead of a pointless move.
  const pick = currentIsBest && mine ? { channel: mine.channel, ...now } : best;
  return {
    band,
    channel: pick.channel,
    span: layout.span(pick.channel, width),
    widthMhz: width,
    overlapping: pick.count,
    currentOverlapping: now?.count ?? null,
    currentIsBest,
  };
}
