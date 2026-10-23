/** Payloads served by /api/wire. Shared by api.ts (server), client.ts and the screens. */

/** Where an address lives: on this Mac, on your local network, or out on the internet. */
export type HostScope = "public" | "private" | "loopback";

export interface HostGeo {
  country: string;
  countryCode: string;
  city: string | null;
  lat: number;
  lon: number;
  isp: string | null;
  org: string | null;
  /** Autonomous system, e.g. "AS714 Apple Inc." */
  as: string | null;
}

/** One app on this Mac and what it does with one remote address. */
export interface HostProcess {
  name: string;
  connections: number;
  ports: number[];
}

/** One remote address with every connection from this Mac to it. */
export interface WireHost {
  ip: string;
  scope: HostScope;
  /** Name from reverse DNS, when the owner publishes one. */
  rdns: string | null;
  /** Null for private and loopback addresses, and for public ones that could not be located. */
  geo: HostGeo | null;
  connections: number;
  ports: number[];
  /** What the busiest remote port is used for, e.g. "HTTPS". */
  service: string | null;
  processes: HostProcess[];
}

export interface WireConnections {
  fetchedAt: number;
  /** Established TCP connections from your own processes. */
  total: number;
  /** Public addresses first, busiest first. */
  hosts: WireHost[];
  /** Why some public addresses have no location, or null when all were located. */
  geoNote: string | null;
}

export interface ListeningSocket {
  process: string;
  pid: number;
  protocol: "TCP" | "UDP";
  port: number;
  /** "*" means every interface. */
  address: string;
  /** Reachable from other devices on your network. */
  exposed: boolean;
  /** Short name of the service, e.g. "AirPlay Receiver". */
  service: string | null;
  /** One plain sentence about what this is for. */
  about: string | null;
}

export interface WireListening {
  fetchedAt: number;
  sockets: ListeningSocket[];
}

/** First line of a trace: which address the host name resolved to. */
export interface TraceStart {
  trace: { host: string; ip: string };
}

export interface TraceHop {
  hop: number;
  ip: string | null;
  rttMs: number | null;
  scope: HostScope | null;
  geo: HostGeo | null;
}

/** A location that arrived after its hop did. */
export interface TraceGeo {
  hop: number;
  geo: HostGeo | null;
}

export interface TraceDone {
  done: true;
  reached: boolean;
  geoNote: string | null;
}

export interface TraceFailure {
  error: { code: string; message: string };
}

export type TraceEvent = TraceStart | TraceHop | TraceGeo | TraceDone | TraceFailure;

declare module "../../app/core/plugin" {
  interface EntityKinds {
    host: WireHost;
  }
}
