import { privateEnabled } from "./registry";
import type { Subprocess } from "bun";
import { watch } from "node:fs";
import { join } from "node:path";

/**
 * Runs server/index.ts in a child process and starts a fresh one when the code changes.
 * `bun --watch` restarts inside the same process and keeps every earlier file watcher open, so after a few dozen
 * restarts the server held 11,000 files and could no longer start any command (EBADF from posix_spawn). A new
 * process per restart starts clean.
 * - Development (`bun run dev`): restarts on server code; browser code updates in place through Bun's hot reload.
 *   Bun's development server refuses pages for any host but localhost, so other devices need production.
 * - Production (`bun run start`, flag `--production`): rebuilds the bundle on any source change. This is the
 *   everyday app, and the one your phone opens through Tailscale.
 */
const ROOT = join(import.meta.dir, "..");
const ENTRY = join(ROOT, "server", "index.ts");
const production = process.argv.includes("--production");
const WATCHED: readonly string[] = [
  ...(production ? ["app", "server", "shared", "scripts", "plugins"] : ["server", "shared", "scripts", "plugins"]),
  // The private plugin tree (private/README.md) is watched only when it takes part in the build.
  ...(privateEnabled() ? ["private"] : []),
];
/** Code the server runs. In development, browser files (views, styles, manifests) reload in the page instead. */
const SERVER_CODE = /^(server|shared|scripts)\/.+\.ts$|\/(api|[^/]+\.server)\.ts$/;
/** Everything the production bundle is built from. Generated files (*.gen.*) are rewritten by each start itself. */
const SOURCE = /\.(ts|tsx|css|html|json|svg|png)$/;
const needsRestart = (file: string): boolean =>
  file !== "scripts/dev.ts" && !file.includes(".gen.") && !file.endsWith(".test.ts") && (production ? SOURCE : SERVER_CODE).test(file);
const SETTLE_MS = 150;

let child: Subprocess | null = null;
let restarting = false;
let again: string | null = null;
let settle: ReturnType<typeof setTimeout> | undefined;

function start(): void {
  // index.html links the generated manifest; write it first so the bundle can find it.
  const manifest = Bun.spawnSync(["bun", "scripts/manifest.ts"], { cwd: ROOT, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  // The bundler would only say it cannot resolve ./manifest.gen.json; name the step that failed.
  if (manifest.exitCode !== 0) console.error(`[${production ? "start" : "dev"}] writing the web app manifest failed; see the error above`);
  const env = production ? { ...process.env, NODE_ENV: "production" } : process.env;
  child = Bun.spawn(["bun", ENTRY], { cwd: ROOT, stdin: "ignore", stdout: "inherit", stderr: "inherit", env });
}

async function restart(file: string): Promise<void> {
  if (restarting) {
    again = file;
    return;
  }
  restarting = true;
  console.log(`[${production ? "start" : "dev"}] ${file} changed; starting a fresh server`);
  child?.kill();
  await child?.exited;
  start();
  restarting = false;
  if (again) {
    const next = again;
    again = null;
    await restart(next);
  }
}

for (const dir of WATCHED) {
  watch(join(ROOT, dir), { recursive: true }, (_event, name) => {
    if (!name) return;
    const file = `${dir}/${name}`;
    if (!needsRestart(file)) return;
    clearTimeout(settle);
    settle = setTimeout(() => void restart(file), SETTLE_MS);
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    child?.kill();
    process.exit(0);
  });
}

start();
