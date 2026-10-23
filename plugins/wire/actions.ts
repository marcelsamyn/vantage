import { go } from "../../app/core/nav";
import { profile } from "../../app/core/profile";
import type { LatLon } from "../../shared/geo";
import { showLayer } from "../city/client";
import { frame } from "./geo";
import type { WireHost } from "./types";

/** Turn a layer on and fly the City map out far enough to see it. */
function showFramed(layerId: string, points: LatLon[]): void {
  showLayer(layerId);
  if (points.length < 2) return;
  const view = frame(points);
  go("city", { action: "fly", arg: `${view.lat.toFixed(3)},${view.lon.toFixed(3)},${view.zoom}` });
}

export function showConnectionsOnMap(origin: LatLon | null, hosts: readonly WireHost[]): void {
  showFramed("wire.connections", origin ? [origin, ...hosts.flatMap((h) => (h.geo ? [h.geo] : []))] : []);
}

export function showTraceOnMap(points: LatLon[]): void {
  showFramed("wire.trace", points);
}

/** Open a host's profile in the shared slot. */
export function openHost(host: WireHost): void {
  profile.open({ kind: "host", id: host.ip, data: host });
}

export function traceTo(ip: string): void {
  go("wire", { action: "trace", arg: ip });
}
