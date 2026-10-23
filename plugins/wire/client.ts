import { useMemo } from "react";
import { api } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { IpLocation } from "../../shared/location";
import type { LatLon } from "../../shared/geo";
import type { WireConnections, WireListening } from "./types";

export function useConnections(intervalMs = 6000): Polled<WireConnections> {
  return usePoll((signal) => api<WireConnections>("/api/wire/connections", { signal }), intervalMs, []);
}

export function useListening(): Polled<WireListening> {
  return usePoll((signal) => api<WireListening>("/api/wire/listening", { signal }), 10_000, []);
}

/** Where the lines start: your position from the location service, or your internet address's city when that is unavailable. */
export interface Origin extends LatLon {
  label: string | null;
}

export function useOrigin(): Origin | null {
  const here = useLocation((s) => s.here);
  const byAddress = usePoll((signal) => api<IpLocation>("/api/core/iploc", { signal }), null, [], here !== null);
  return useMemo((): Origin | null => {
    if (here) return { lat: here.lat, lon: here.lon, label: here.label };
    return byAddress.data ? { lat: byAddress.data.lat, lon: byAddress.data.lon, label: byAddress.data.city } : null;
  }, [here, byAddress.data]);
}

/** Same as `useOrigin`, for code that runs outside React. */
export async function resolveOrigin(): Promise<Origin | null> {
  const here = useLocation.getState().here;
  if (here) return { lat: here.lat, lon: here.lon, label: here.label };
  try {
    const ip = await api<IpLocation>("/api/core/iploc");
    return { lat: ip.lat, lon: ip.lon, label: ip.city };
  } catch {
    return null;
  }
}
