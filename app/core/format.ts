import type { Units } from "./settings";

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const fmt = {
  int: (n: number): string => nf0.format(n),
  one: (n: number): string => nf1.format(n),

  distance(m: number, units: Units): string {
    if (units === "imperial") {
      const ft = m * 3.28084;
      return ft < 1000 ? `${nf0.format(ft)} ft` : `${nf1.format(m / 1609.344)} mi`;
    }
    return m < 1000 ? `${nf0.format(m)} m` : `${m < 10_000 ? nf1.format(m / 1000) : nf0.format(m / 1000)} km`;
  },

  /** Altitude: aviation uses feet worldwide, so feet are always shown, metres alongside for metric users. */
  altitude(ft: number, units: Units): string {
    return units === "imperial" ? `${nf0.format(ft)} ft` : `${nf0.format(ft)} ft · ${nf1.format((ft * 0.3048) / 1000)} km`;
  },

  speedKnots(kt: number, units: Units): string {
    return units === "imperial" ? `${nf0.format(kt * 1.15078)} mph` : `${nf0.format(kt * 1.852)} km/h`;
  },

  temp(c: number, units: Units): string {
    return units === "imperial" ? `${nf0.format((c * 9) / 5 + 32)}°F` : `${nf0.format(c)}°C`;
  },

  bytes(b: number): string {
    const u = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let v = b;
    while (v >= 1024 && i < u.length - 1) {
      v /= 1024;
      i++;
    }
    return `${i === 0 ? nf0.format(v) : nf1.format(v)} ${u[i]}`;
  },

  bitsPerSecond(bps: number): string {
    if (bps >= 1e9) return `${nf1.format(bps / 1e9)} Gb/s`;
    if (bps >= 1e6) return `${nf1.format(bps / 1e6)} Mb/s`;
    if (bps >= 1e3) return `${nf0.format(bps / 1e3)} kb/s`;
    return `${nf0.format(bps)} b/s`;
  },

  coord(lat: number, lon: number): string {
    const ns = lat >= 0 ? "N" : "S";
    const ew = lon >= 0 ? "E" : "W";
    return `${Math.abs(lat).toFixed(4)}°${ns} ${Math.abs(lon).toFixed(4)}°${ew}`;
  },

  ago(ts: number, now = Date.now()): string {
    const s = Math.max(0, Math.round((now - ts) / 1000));
    if (s < 5) return "now";
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return `${Math.round(h / 24)}d ago`;
  },

  /** "in 4 min", "in 2 h 10 min" */
  until(ts: number, now = Date.now()): string {
    const m = Math.round((ts - now) / 60_000);
    if (m <= 0) return "now";
    if (m < 60) return `in ${m} min`;
    const h = Math.floor(m / 60);
    return `in ${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  },

  clock(ts: number, seconds = false): string {
    return new Date(ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: seconds ? "2-digit" : undefined });
  },

  duration(seconds: number): string {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m) return `${m}m ${String(r).padStart(2, "0")}s`;
    return `${r}s`;
  },
};
