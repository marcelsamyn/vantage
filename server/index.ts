import { rm } from "node:fs/promises";
import { join } from "node:path";
import { localEnabled, privateEnabled, writeRegistry } from "../scripts/registry";
import { coreSource } from "./core";
import { serverConfig } from "./lib/config";
import { json } from "./lib/http";
import { log } from "./lib/log";
import { absoluteShareUrls } from "./lib/share";
import { collectProbes, discoverPluginSources, makeGuard, mountAssets, mountSources } from "./lib/router";
import { extraLoginsFromEnv, readTailnet, tailnetAccess } from "./lib/tailnet";

/**
 * VANTAGE server kernel.
 * 0. Regenerate plugins/registry.gen.ts, the browser's list of plugin manifests, before the app is bundled.
 * 1. Discover plugin APIs (plugins/<id>/api.ts) and mount them at /api/<id>/….
 *    Plugin static assets are served at /assets/<id>/<name>/….
 * 2. Mount the kernel's own API at /api/core/….
 * 3. Serve the app: bundled live with hot reload in development, split and minified in production.
 * Binds to loopback unless VANTAGE_ORIGIN configures a hosted origin with local features off.
 *
 * With VANTAGE_LOCAL=1 and VANTAGE_PRIVATE=1 the tree in private/plugins/ is added to both steps 0 and 1 (see private/README.md). Off, it
 * is never imported, bundled or mounted.
 */

const ROOT = join(import.meta.dir, "..");
const PLUGINS_DIR = join(ROOT, "plugins");
const PRIVATE_PLUGINS_DIR = join(ROOT, "private", "plugins");
/** Extra plugin trees to mount when VANTAGE_PRIVATE=1; empty otherwise, so the everyday app never serves them. */
const privateDirs = (): string[] => (privateEnabled() ? [PRIVATE_PLUGINS_DIR] : []);
const config = serverConfig(process.env);
const PORT = config.port;
const production = process.env.NODE_ENV === "production";
const guard = makeGuard(PORT, localEnabled() ? tailnetAccess(readTailnet(PORT, extraLoginsFromEnv())) : undefined, config.origin);

type AppRoutes = Bun.Serve.Routes<undefined, string>;

async function apiRoutes(): Promise<AppRoutes> {
  const plugins = await discoverPluginSources(PLUGINS_DIR, privateDirs());
  const core = coreSource(collectProbes(plugins));
  return {
    ...mountAssets(plugins, ROOT),
    ...mountSources([{ id: "core", source: core }, ...plugins], guard),
    "/healthz": () => json({ ok: true }),
    "/api/*": () => json({ error: { code: "not_found", message: "No such API route" } }, { status: 404 }),
  };
}

/**
 * The icons and screenshots the web app manifest names (see scripts/manifest.ts), and the link-preview image index.html
 * names. The bundler leaves these paths alone, so they need fixed URLs, the same in development and production.
 */
async function fixedImages(): Promise<AppRoutes> {
  const routes: AppRoutes = {};
  for (const dir of ["icons", "screenshots", "social"]) {
    for await (const name of new Bun.Glob("*.{png,jpg}").scan({ cwd: join(ROOT, "app", dir) })) {
      const file = Bun.file(join(ROOT, "app", dir, name));
      routes[`/${dir}/${name}`] = new Response(await file.bytes(), { headers: { "content-type": file.type, "cache-control": "public, max-age=86400" } });
    }
  }
  return routes;
}

async function frontend(): Promise<AppRoutes> {
  const icons = await fixedImages();
  if (!production) {
    const { default: index } = await import("../app/index.html");
    return { "/": index, ...icons };
  }
  // Split the bundle so heavy plugins (camera AI, maps) load only when opened.
  const outdir = join(ROOT, "dist");
  // Chunk names change with every build; clear the folder so old chunks do not pile up.
  await rm(outdir, { recursive: true, force: true });
  const build = await Bun.build({ entrypoints: [join(ROOT, "app", "index.html")], outdir, splitting: true, minify: true, target: "browser" });
  if (!build.success) throw new AggregateError(build.logs, "Frontend build failed");
  if (config.origin) {
    const page = Bun.file(join(outdir, "index.html"));
    await Bun.write(page, absoluteShareUrls(await page.text(), config.origin));
  }
  // No other page may frame the app and trick clicks onto its controls.
  const headers = { "content-security-policy": "frame-ancestors 'none'", "x-frame-options": "DENY" };
  return {
    ...icons,
    "/*": async (req: Request) => {
      const path = new URL(req.url).pathname;
      const file = Bun.file(join(outdir, path === "/" ? "index.html" : path));
      return new Response(!path.includes("..") && (await file.exists()) ? file : Bun.file(join(outdir, "index.html")), { headers });
    },
  };
}

await writeRegistry();
const web = await frontend();
const server = Bun.serve({
  port: PORT,
  hostname: config.hostname,
  idleTimeout: 120,
  development: production ? false : { hmr: true, console: true },
  routes: { ...web, ...(await apiRoutes()) },
});

log.info("VANTAGE online", { url: server.url.href, mode: production ? "production" : "development" });

// In development, a new or deleted plugin folder takes effect without a restart: its manifest joins the registry,
// which the browser bundle hot-reloads, and its api.ts is mounted. Edits to files the server already imports restart
// it through `bun --watch` (`--hot` reloads in place, which left timers in route handlers unreliable). The list of
// plugin.ts and api.ts files is polled every two seconds: file-system events proved unreliable here (editors write
// through temporary files, and macOS drops events).
const dev = globalThis as { vantagePoller?: ReturnType<typeof setInterval> };
if (!production) {
  clearInterval(dev.vantagePoller);
  const apiFiles = async (): Promise<string> => {
    const scan = async (dir: string): Promise<string[]> => (await Array.fromAsync(new Bun.Glob("*/{plugin,api}.ts").scan({ cwd: dir }))).map((rel) => join(dir, rel)).sort();
    return (await Promise.all([PLUGINS_DIR, ...privateDirs()].map(scan))).flat().join(",");
  };
  let tracked = await apiFiles();
  let failure = "";
  let busy = false;
  dev.vantagePoller = setInterval(async () => {
    // A slow mount must not overlap the next tick: both would write the registry and reload at once.
    if (busy) return;
    busy = true;
    try {
      const current = await apiFiles();
      // `tracked` moves only after a successful mount, so a half-written api.ts is retried until it loads.
      if (current === tracked && !failure) return;
      await writeRegistry();
      server.reload({ routes: { ...web, ...(await apiRoutes()) } });
      tracked = current;
      failure = "";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== failure) log.error("plugin reload failed", { error: message });
      failure = message;
    } finally {
      busy = false;
    }
  }, 2000);
}
