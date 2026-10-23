import type { BunRequest } from "bun";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pluginEnabled } from "../../scripts/registry";
import { errorResponse, json } from "./http";
import { log } from "./log";
import { isSource, type Probe, type RouteHandler, type Source } from "./source";
import type { Tailnet } from "./tailnet";

type Method = "GET" | "POST";
type MethodRoutes = Partial<Record<Method, RouteHandler>>;
export type Routes = Record<string, MethodRoutes | { dir: string }>;

const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

/** Find `<dir>/<id>/api.ts` files and load each default-exported source. */
export async function discoverPluginSources(pluginsDir: string, extraDirs: readonly string[] = []): Promise<{ id: string; source: Source }[]> {
  const found: { id: string; source: Source }[] = [];
  const scan = async (dir: string): Promise<void> => {
    for await (const rel of new Bun.Glob("*/api.ts").scan({ cwd: dir })) {
      const id = rel.split("/")[0] ?? "";
      if (!PLUGIN_ID.test(id)) throw new Error(`Plugin folder "${id}" must be lowercase letters, digits and dashes`);
      if (!(await pluginEnabled(join(dir, id)))) continue;
      const mod: { default?: unknown } = await import(join(dir, rel));
      if (!isSource(mod.default)) throw new Error(`${rel} must default-export defineSource({ routes })`);
      found.push({ id, source: mod.default });
    }
  };
  await scan(pluginsDir);
  for (const dir of extraDirs) await scan(dir);
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

export function collectProbes(sources: { id: string; source: Source }[]): { plugin: string; probe: Probe }[] {
  return sources.flatMap(({ id, source }) => (source.probes ?? []).map((probe) => ({ plugin: id, probe })));
}

/** Mount each source's routes under /api/<id>, behind the guard. */
export function mountSources(sources: { id: string; source: Source }[], guard: (h: RouteHandler) => RouteHandler): Record<string, MethodRoutes> {
  const routes: Record<string, MethodRoutes> = {};
  for (const { id, source } of sources) {
    for (const [key, handler] of Object.entries(source.routes)) {
      if (!handler) continue;
      const [method, path] = key.split(" ") as [Method, string];
      const full = `/api/${id}${path === "/" ? "" : path}`;
      const slot = (routes[full] ??= {});
      if (slot[method]) throw new Error(`Route ${method} ${full} is defined twice`);
      slot[method] = guard(handler);
    }
  }
  log.info("plugin APIs mounted", { plugins: sources.map((s) => s.id), routes: Object.keys(routes).length });
  return routes;
}

/**
 * Serve each source's static asset folders at /assets/<id>/<name>/…. A folder must sit inside one package in
 * node_modules or inside the plugin's own folder, so no asset route can expose the project root, .cache or .data.
 */
export function mountAssets(sources: { id: string; source: Source }[], root: string): Routes {
  const routes: Routes = {};
  for (const { id, source } of sources) {
    for (const [name, path] of Object.entries(source.assets ?? {})) {
      const dir = resolve(root, path);
      const inside = (base: string): boolean => {
        const rel = relative(join(root, base), dir);
        return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
      };
      if (!inside("node_modules") && !inside(join("plugins", id))) {
        throw new Error(`Plugin "${id}" asset "${name}" must be a folder inside node_modules/<package> or plugins/${id}/: ${path}`);
      }
      routes[`/assets/${id}/${name}/*`] = { dir };
    }
  }
  return routes;
}

/**
 * Every API route reads local machine state or spends the user's rate limits, so it only answers this app:
 * - the Host check blocks DNS-rebinding pages that point their own domain at 127.0.0.1. The one other host is this
 *   Mac's Tailscale name, which only Tailscale Serve can send here, and only for an allowed Tailscale login: Serve
 *   sets the caller's identity headers itself. A request that came through any proxy is judged as remote even when
 *   its Host says localhost, and Funnel (public internet) requests are refused on every host;
 * - the Sec-Fetch-Site and Origin checks block other websites from triggering requests through the browser
 *   (Origin covers browsers that do not send Sec-Fetch-Site);
 * - a request that changes something must carry `x-vantage: 1`. A browser sends a custom header cross-site only
 *   after a CORS preflight, which this server never grants, and a server-side fetch that a hostile redirect turns
 *   back at this API never carries it.
 */
/** Headers a proxy adds. A browser on this Mac never sends them, so their presence means the request came from afar. */
const PROXY_HEADERS = ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "tailscale-user-login"] as const;

export function makeGuard(port: number, tailnet: () => Promise<Tailnet | null> = async () => null, deploymentOrigin?: string): (h: RouteHandler) => RouteHandler {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const localOrigins = new Set([...allowedHosts].map((host) => `http://${host}`));
  const deploymentHost = deploymentOrigin ? new URL(deploymentOrigin).host : undefined;
  const deploymentOrigins = new Set(deploymentOrigin ? [deploymentOrigin] : []);
  return (handler) => async (req: BunRequest<string>) => {
    // Funnel publishes to the whole internet; nothing of VANTAGE answers there, whatever the Host says.
    if (req.headers.has("tailscale-funnel-request")) {
      return json({ error: { code: "funnel", message: "VANTAGE does not answer through Tailscale Funnel" } }, { status: 403 });
    }
    const proxied = PROXY_HEADERS.some((name) => req.headers.has(name));
    const host = ((proxied ? req.headers.get("x-forwarded-host") : null) ?? req.headers.get("host") ?? "").toLowerCase();
    let allowedOrigins = localOrigins;
    if (deploymentHost && host === deploymentHost) {
      allowedOrigins = deploymentOrigins;
    } else if (proxied || !allowedHosts.has(host)) {
      const net = await tailnet();
      if (!net || (host !== net.host && host !== `${net.host}:443`)) {
        return json({ error: { code: "bad_host", message: "VANTAGE answers only on localhost, or through Tailscale Serve" } }, { status: 421 });
      }
      const login = (req.headers.get("tailscale-user-login") ?? "").toLowerCase();
      if (!net.logins.has(login)) {
        return json(
          { error: { code: "tailnet_user", message: "This Tailscale account may not use VANTAGE. Add it to VANTAGE_TAILSCALE_LOGINS on the Mac." } },
          { status: 403 },
        );
      }
      allowedOrigins = new Set([`https://${net.host}`]);
    }
    const site = req.headers.get("sec-fetch-site");
    const origin = req.headers.get("origin");
    if ((site && site !== "same-origin" && site !== "none") || (origin !== null && !allowedOrigins.has(origin))) {
      return json({ error: { code: "cross_site", message: "Cross-site requests are refused" } }, { status: 403 });
    }
    if (req.method !== "GET" && req.method !== "HEAD" && req.headers.get("x-vantage") !== "1") {
      return json({ error: { code: "client_header", message: "Requests that change something must come from the VANTAGE app (header x-vantage: 1)" } }, { status: 403 });
    }
    try {
      return await handler(req);
    } catch (err) {
      return errorResponse(err, req);
    }
  };
}
