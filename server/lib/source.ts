import type { BunRequest } from "bun";

export type RouteHandler = (req: BunRequest<string>) => Response | Promise<Response>;

/** "GET /near", "POST /inspect", "GET /stream/:id" — paths are relative to /api/<source-folder>. */
export type RouteKey = `${"GET" | "POST"} /${string}`;

export interface Probe {
  /** Shown on the boot screen, e.g. "Aircraft · adsb.lol". */
  name: string;
  /** A cheap URL that answers 2xx when the upstream is healthy. */
  url: string;
}

export interface Source {
  /** Upstreams this source depends on. The kernel checks them for the boot screen and /api/health. */
  probes?: Probe[];
  routes: Partial<Record<RouteKey, RouteHandler>>;
  /**
   * Static folders to serve, as name → path relative to the project root. Served at
   * /assets/<plugin>/<name>/… — e.g. a library's web worker, model weights or WebAssembly.
   */
  assets?: Record<string, string>;
}

/**
 * Declare a plugin's server side. Put it in `plugins/<id>/api.ts` as the default export and the kernel
 * mounts every route under `/api/<id>/…` (and assets under `/assets/<id>/…`) — no registration needed.
 */
export function defineSource(source: Source): Source {
  return source;
}

export function isSource(value: unknown): value is Source {
  return typeof value === "object" && value !== null && "routes" in value && typeof (value as Source).routes === "object";
}
