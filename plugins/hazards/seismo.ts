import { distanceM } from "../../shared/geo";
import type { Trace } from "./miniseed";
import type { SeismoStation, SeismoTrace } from "./types";

/** Station lists and trace processing for the live seismograph. Pure functions; the network calls live in seismo.server.ts. */

export interface Node {
  id: string;
  base: string;
  /** Search radius in degrees of arc (111 km each). */
  radiusDeg: number;
  channels: string;
  /** Limit the station list to one network. INGV's server answers much faster when asked only for its own national network. */
  network?: string;
  citizen: boolean;
}

/** FDSN web services run by seismic data centres, which publish station lists and waveforms for the public. */
export const NODES: Node[] = [
  { id: "earthscope", base: "https://service.iris.edu", radiusDeg: 3, channels: "HH?,BH?,EH?", citizen: false },
  { id: "ingv", base: "https://webservices.ingv.it", radiusDeg: 2, channels: "HH?,EH?", network: "IV", citizen: false },
  { id: "raspberryshake", base: "https://data.raspberryshake.org", radiusDeg: 1.5, channels: "EHZ", citizen: true },
];

/**
 * INGV's stations within about 11 km of a volcano's summit, for the Volcanoes mode. Kept apart from NODES because it
 * is searched around a crater, not around the viewer.
 */
export const VOLCANO_NODE: Node = { id: "ingv-volcano", base: "https://webservices.ingv.it", radiusDeg: 0.1, channels: "HH?,EH?", network: "IV", citizen: false };

/** Italy's three volcanoes with live public seismometers, and the point each station's distance is measured from. */
export const VOLCANOES = [
  { id: "etna", name: "Etna", summitName: "summit craters", summit: { lat: 37.751, lon: 14.9934 } },
  { id: "stromboli", name: "Stromboli", summitName: "crater terrace", summit: { lat: 38.7894, lon: 15.2134 } },
  { id: "campi-flegrei", name: "Campi Flegrei", summitName: "Solfatara crater", summit: { lat: 40.8275, lon: 14.1389 } },
] as const;

/** Who runs a network, for the profile. Unlisted networks show their code. */
const OPERATORS: Record<string, string> = {
  BE: "Royal Observatory of Belgium",
  IV: "INGV, Italy",
  MN: "MedNet (INGV)",
  NL: "KNMI, Netherlands",
  GE: "GEOFON (GFZ Potsdam)",
  GR: "German Regional Seismic Network",
  RD: "RESIF, France",
  FR: "RESIF, France",
  CH: "Swiss Seismological Service",
  OE: "ZAMG, Austria",
  AM: "Raspberry Shake community",
  IU: "Global Seismographic Network",
  II: "Global Seismographic Network",
};

export interface Candidate {
  node: Node;
  station: SeismoStation;
  /** Location code as the service expects it ("" for none). */
  location: string;
  /** Sensor sensitivity in counts per metre per second. */
  scale: number;
}

const CHANNEL_PREFERENCE = ["HHZ", "EHZ", "BHZ"];
const CODE = /^[A-Za-z0-9]{1,8}$/;
const TRACE_BINS = 900;

/**
 * Parse an FDSN `level=channel&format=text` listing into one candidate per station: its vertical velocity channel that is
 * still operating. Columns: Network|Station|Location|Channel|Lat|Lon|Elevation|Depth|Azimuth|Dip|Sensor|Scale|ScaleFreq|ScaleUnits|SampleRate|Start|End.
 */
export function parseChannels(text: string, node: Node, from: { lat: number; lon: number }): Candidate[] {
  const best = new Map<string, { candidate: Candidate; pref: number }>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("|").map((s) => s.trim());
    const [net, sta, loc, cha, lat, lon, , , , , , scale, , units, rate, , end] = f;
    if (!net || !sta || !cha || !CODE.test(net) || !CODE.test(sta) || !/^[A-Z]{3}$/.test(cha)) continue;
    if (end) continue; // closed epoch
    if (!/^m\/s$/i.test(units ?? "")) continue; // accelerometers use other units; the trace shows velocity
    const pref = CHANNEL_PREFERENCE.indexOf(cha);
    const sensitivity = Number(scale);
    if (pref < 0 || !(sensitivity > 0) || !(Number(rate) >= 20)) continue;
    const position = { lat: Number(lat), lon: Number(lon) };
    if (!Number.isFinite(position.lat) || !Number.isFinite(position.lon)) continue;
    const id = `${net}.${sta}`;
    if ((best.get(id)?.pref ?? 9) <= pref) continue;
    best.set(id, {
      pref,
      candidate: {
        node,
        location: loc ?? "",
        scale: sensitivity,
        station: {
          id,
          network: net,
          code: sta,
          channel: cha,
          lat: position.lat,
          lon: position.lon,
          distanceKm: distanceM(from, position) / 1000,
          operator: OPERATORS[net] ?? `Network ${net}`,
          citizen: node.citizen,
        },
      },
    });
  }
  return [...best.values()].map((b) => b.candidate);
}

/** High-pass by subtracting a moving average, so slow instrument drift does not push the trace off the screen. */
export function highPass(values: Float64Array, windowSamples: number): Float64Array {
  const n = values.length;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = (prefix[i] ?? 0) + (values[i] ?? 0);
  const half = Math.max(1, Math.floor(windowSamples / 2));
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    out[i] = (values[i] ?? 0) - ((prefix[b] ?? 0) - (prefix[a] ?? 0)) / (b - a);
  }
  return out;
}

/**
 * Fit a trace onto a fixed time window and summarise it: counts become nanometres per second, drift is removed, and the window is
 * cut into equal bins that each keep their lowest and highest value. Time the station did not cover reads as zero.
 * Returns null when the trace holds no finite sample.
 */
export function summarise(trace: Trace, scale: number, windowStartMs: number, windowEndMs: number): Pick<SeismoTrace, "bins" | "peakNmS" | "rmsNmS"> | null {
  const total = Math.round(((windowEndMs - windowStartMs) / 1000) * trace.sampleRate);
  const finite = Array.from(trace.samples).filter(Number.isFinite).sort((a, b) => a - b);
  if (finite.length === 0 || total < TRACE_BINS) return null;
  const median = finite[Math.floor(finite.length / 2)] ?? 0;
  const offset = Math.round(((trace.startMs - windowStartMs) / 1000) * trace.sampleRate);
  const velocity = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const v = trace.samples[i - offset];
    velocity[i] = v === undefined || !Number.isFinite(v) ? 0 : ((v - median) / scale) * 1e9;
  }
  const flat = highPass(velocity, Math.round(trace.sampleRate * 20));
  const bins: [number, number][] = [];
  let peak = 0;
  let sumSquares = 0;
  for (let b = 0; b < TRACE_BINS; b++) {
    const from = Math.floor((b * total) / TRACE_BINS);
    const to = Math.floor(((b + 1) * total) / TRACE_BINS);
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = from; i < to; i++) {
      const v = flat[i] ?? 0;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      peak = Math.max(peak, Math.abs(v));
      sumSquares += v * v;
    }
    bins.push([round1(lo), round1(hi)]);
  }
  return { bins, peakNmS: round1(peak), rmsNmS: round1(Math.sqrt(sumSquares / total)) };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
