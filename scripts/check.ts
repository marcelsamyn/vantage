/**
 * Architecture check. Keeps the layers honest so the codebase stays easy to extend.
 *
 *   bun run check        (registry, type-check, this script, tests)
 *
 * Rules
 *  1. shared/   is pure: imports only shared/ and npm packages.
 *  2. server/   never imports app/ or plugins/ (plugin APIs are discovered at runtime), except app/index.html.
 *  3. app/      (kernel client) imports plugins/ only through plugins/index.ts.
 *  4. Plugin server files (api.ts, *.server.ts, *.test.ts) import server/kit.ts — not server/lib — plus shared/,
 *     and types.ts / *.server.ts of any plugin. Never app/ or client code.
 *  5. Plugin client files import app/core/*, app/ui, shared/, their own folder, and another plugin's
 *     public surface only: types.ts, client.ts, extension.ts. Never server/, app/shell/ or app/styles/.
 *  6. Every CSS class in plugins/<id>/*.css is "<id>" or starts with "<id>-", so plugins never collide.
 *  7. Every folder in plugins/ is a plugin: it has a plugin.ts that declares id "<id>", the folder name.
 *  8. Manifests load at startup, before any screen opens. plugin.ts, glyph.ts and settings.ts import at runtime only
 *     app/core/plugin (definePlugin, defineSettings), a plugin's extension.ts (constants such as MAP_INK) and their
 *     own ./glyph and ./settings.
 *     Type-only imports are free; everything else loads later through () => import().
 *  9. Every infinite CSS animation ends its shorthand with var(--v-loop), so it rests with the motion policy.
 * 10. Only app/styles/tokens.css sets values on :root. The production bundle may order stylesheets differently from
 *     development, so a token override in another file can silently lose to the default it overrides.
 */
import { privateEnabled } from "./registry";
import { readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const problems: string[] = [];
/** Record a broken rule. `line` 0 points at a folder or a whole file. */
const fail = (file: string, line: number, rule: string): void => {
  problems.push(`${relative(ROOT, file)}${line ? `:${line}` : ""}  ${rule}`);
};

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

// The clause before `from` stops at ";", so an `export const …;` never runs on into the next statement's import.
const IMPORT = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["'`]([^"'`$]+)["'`]\s*\)/g;

/** How an import loads: with the importing file ("static"), never ("type"), or on first use ("lazy"). */
type ImportKind = "static" | "type" | "lazy";

function imports(source: string): { spec: string; line: number; kind: ImportKind }[] {
  const out: { spec: string; line: number; kind: ImportKind }[] = [];
  for (const m of source.matchAll(IMPORT)) {
    const spec = m[2] ?? m[3];
    if (!spec) continue;
    const line = source.slice(0, m.index ?? 0).split("\n").length + (source[m.index ?? 0] === "\n" ? 1 : 0);
    out.push({ spec, line, kind: m[3] ? "lazy" : m[1] ? "type" : "static" });
  }
  return out;
}

const area = (abs: string): string => relative(ROOT, abs).split("/")[0] ?? "";
/** The private plugin tree (private/README.md) takes part only when VANTAGE_PRIVATE=1. */
const PRIVATE = privateEnabled();
const pluginOf = (abs: string): string | null => {
  const parts = relative(ROOT, abs).split("/");
  if (parts[0] === "plugins" && parts.length > 2) return parts[1] ?? null;
  if (parts[0] === "private" && parts[1] === "plugins" && parts.length > 3) return parts[2] ?? null;
  return null;
};
/** Whether an absolute path lives in a plugin tree: plugins/<id>/ or private/plugins/<id>/. */
const inPlugins = (abs: string): boolean => {
  const parts = relative(ROOT, abs).split("/");
  return (parts[0] === "plugins" && parts.length > 2) || (parts[0] === "private" && parts[1] === "plugins" && parts.length > 3);
};
// Tests run under `bun test` on the server side, so they may import the server code they test.
const isServerFile = (abs: string): boolean => /\/api\.ts$|\.server\.ts$|\.test\.ts$/.test(abs);
const PUBLIC_SURFACE = /\/(types|client|extension)\.tsx?$/;

function resolveSpec(from: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null; // npm package or builtin
  return resolve(dirname(from), spec);
}

function withExt(abs: string): string {
  if (/\.(tsx?|css|html)$/.test(abs)) return abs;
  for (const ext of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    if (Bun.file(abs + ext).size > 0) return abs + ext;
  }
  return abs;
}

const files = (await Promise.all([...["app", "server", "shared", "plugins", "scripts"], ...(PRIVATE ? ["private"] : [])].map((d) => walk(join(ROOT, d))))).flat();

for (const file of files.filter((f) => /\.tsx?$/.test(f))) {
  const src = await Bun.file(file).text();
  const from = area(file);
  const plugin = pluginOf(file);

  for (const { spec, line } of imports(src)) {
    const target = resolveSpec(file, spec);
    if (!target) continue;
    const abs = withExt(target);
    const to = area(abs);
    const rel = relative(ROOT, abs);

    if (from === "shared" && to !== "shared") fail(file, line, `shared/ must stay pure, but imports ${rel}`);

    // The one sanctioned link: the server serves the app's HTML entry.
    if (from === "server" && (to === "app" || inPlugins(abs)) && rel !== "app/index.html") fail(file, line, `server/ must not import ${rel}`);

    if (from === "app" && inPlugins(abs) && rel !== "plugins/index.ts") fail(file, line, `kernel imports plugin internals (${rel}); go through plugins/index.ts or an extension point`);

    if (plugin && isServerFile(file)) {
      const ok =
        rel === "server/kit.ts" ||
        to === "shared" ||
        (inPlugins(abs) && (/\/types\.ts$/.test(rel) || isServerFile(abs) || pluginOf(abs) === plugin && !/\.tsx$/.test(rel)));
      if (!ok) fail(file, line, `plugin server code may import server/kit.ts, shared/, and plugin types.ts / *.server.ts — not ${rel}`);
    }

    if (plugin && !isServerFile(file)) {
      if (to === "server") fail(file, line, `client code must not import server code (${rel})`);
      if (inPlugins(abs) && isServerFile(abs)) fail(file, line, `client code must not import plugin server code (${rel})`);
      if (rel.startsWith("app/shell/") || rel.startsWith("app/styles/")) fail(file, line, `plugins use app/core and app/ui, not ${rel}`);
      const other = pluginOf(abs);
      if (other && other !== plugin && !PUBLIC_SURFACE.test(abs)) {
        fail(file, line, `imports ${rel}, which is internal to plugin "${other}" — use its types.ts, client.ts or extension.ts`);
      }
    }
  }
}

// CSS prefix rule
for (const file of files.filter((f) => f.endsWith(".css"))) {
  const plugin = pluginOf(file);
  if (!plugin) continue;
  const src = await Bun.file(file).text();
  const lines = src.split("\n");
  lines.forEach((text, i) => {
    if (text.trimStart().startsWith("/*") || text.includes(":") && !text.includes("{")) return;
    for (const m of text.matchAll(/\.([a-zA-Z_][\w-]*)/g)) {
      const cls = m[1] ?? "";
      if (/^\d/.test(cls) || text.trim().startsWith("@")) continue;
      if (cls !== plugin && !cls.startsWith(`${plugin}-`) && !cls.startsWith("v-")) fail(file, i + 1, `CSS class ".${cls}" must be "${plugin}" or start with "${plugin}-"`);
    }
  });
}

// Ambient loops follow the motion policy (app/core/motion.ts): an infinite CSS animation rests with the page.
for (const file of files.filter((f) => f.endsWith(".css"))) {
  const lines = (await Bun.file(file).text()).split("\n");
  lines.forEach((text, i) => {
    if (/^\s*animation(-iteration-count)?\s*:[^;]*\binfinite\b/.test(text) && !text.includes("var(--v-loop)")) {
      fail(file, i + 1, `an infinite animation must rest with the motion policy: end its "animation" shorthand with var(--v-loop)`);
    }
  });
}

// Tokens live in one file, defaults first and per-device overrides after them, so stylesheet order cannot matter.
for (const file of files.filter((f) => f.endsWith(".css") && relative(ROOT, f) !== join("app", "styles", "tokens.css"))) {
  const lines = (await Bun.file(file).text()).split("\n");
  lines.forEach((text, i) => {
    if (/^\s*:root\b[^{,]*\{/.test(text)) fail(file, i + 1, "set tokens on :root only in app/styles/tokens.css, after their defaults");
  });
}

// Plugin folders: the registry is generated from them, so each one must be a complete plugin.
for (const tree of [...["plugins"], ...(PRIVATE ? ["private/plugins"] : [])]) {
  for (const entry of await readdir(join(ROOT, tree), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = Bun.file(join(ROOT, tree, entry.name, "plugin.ts"));
    if (!(await manifest.exists())) fail(join(ROOT, tree, entry.name), 0, `every folder in ${tree}/ is a plugin, but this one has no plugin.ts`);
    else if (/definePlugin\(\s*\{\s*id:\s*"([^"]+)"/.exec(await manifest.text())?.[1] !== entry.name) fail(join(ROOT, tree, entry.name, "plugin.ts"), 1, `plugin id must equal its folder name "${entry.name}"`);
  }
}

// Map layers and kinds of thing name a group that some plugin declares, and a thing source names declared types.
// A typo would otherwise drop a switch into "Other", or leave a source feeding nothing at all.
{
  const manifests = files.filter((f) => /^(?:private\/)?plugins\/[^/]+\/plugin\.ts$/.test(relative(ROOT, f)));
  const texts = await Promise.all(manifests.map(async (file) => ({ file, text: await Bun.file(file).text() })));
  /** The contents of one array-valued point in a manifest, up to the line that closes it. */
  const block = (text: string, point: string): string => new RegExp(`${point}:\\s*\\[([\\s\\S]*?)\\n\\s{4}\\]`).exec(text)?.[1] ?? "";
  const ids = (source: string): string[] => [...source.matchAll(/id:\s*"([^"]+)"/g)].flatMap((m) => (m[1] ? [m[1]] : []));
  const lineOf = (text: string, match: string | undefined): number => text.slice(0, match === undefined ? 0 : text.indexOf(match)).split("\n").length;
  const groups = new Set(texts.flatMap(({ text }) => ids(/mapLayerGroups:\s*\[([\s\S]*?)\]/.exec(text)?.[1] ?? "")));
  const types = new Set(texts.flatMap(({ text }) => ids(block(text, "thingTypes"))));
  for (const { file, text } of texts) {
    for (const point of ["mapLayers", "thingTypes"]) {
      for (const [match, group] of block(text, point).matchAll(/group:\s*"([^"]+)"/g)) {
        if (group !== undefined && !groups.has(group)) fail(file, lineOf(text, match), `${point} group "${group}" is not declared by any plugin's mapLayerGroups`);
      }
    }
    for (const [match, list] of block(text, "thingSources").matchAll(/types:\s*\[([^\]]*)\]/g)) {
      for (const [, type] of (list ?? "").matchAll(/"([^"]+)"/g)) {
        if (type !== undefined && !types.has(type)) fail(file, lineOf(text, match), `thing source feeds type "${type}", which no plugin declares in thingTypes`);
      }
    }
  }
}

// Manifests stay light
for (const file of files.filter((f) => /^(?:private\/)?plugins\/[^/]+\/(plugin|glyph|settings)\.ts$/.test(relative(ROOT, f)))) {
  const plugin = pluginOf(file) ?? "";
  for (const { spec, line, kind } of imports(await Bun.file(file).text())) {
    if (kind !== "static") continue;
    const target = resolveSpec(file, spec);
    const rel = target ? relative(ROOT, withExt(target)) : spec;
    const ok = rel === "app/core/plugin.ts" || /^(?:private\/)?plugins\/[^/]+\/extension\.ts$/.test(rel) || pluginOf(resolve(ROOT, rel)) === plugin && /\/(plugin|glyph|settings)\.ts$/.test(rel);
    if (!ok) fail(file, line, `manifests load at startup, so they import at runtime only app/core/plugin, a plugin's extension.ts and their own ./glyph and ./settings — load ${rel} with () => import(), or import only its types`);
  }
}

if (problems.length) {
  console.error(`Architecture check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`Architecture check passed · ${files.length} files`);
