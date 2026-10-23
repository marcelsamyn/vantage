/**
 * Scaffold a plugin.
 *
 *   bun run new <id> [--screen [--section <section>]] [--tile] [--api]
 *
 * Creates plugins/<id>/ with a manifest and the parts you ask for. Nothing else is edited: the registry is generated
 * from the plugin folders, the rail places the screen by its section, and the server mounts api.ts by its folder.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RAIL_SECTIONS, type RailSection } from "../app/core/plugin";
import { writeRegistry } from "./registry";

const ROOT = resolve(import.meta.dir, "..");
const USAGE = `Usage: bun run new <id> [--screen [--section ${RAIL_SECTIONS.join("|")}]] [--tile] [--api]
  <id> is lowercase letters, digits and dashes; it becomes the folder, the CSS prefix and /api/<id>.
  --section places the screen in the rail (default "tools").`;
const [id, ...flags] = process.argv.slice(2);

function stop(message: string): never {
  console.error(message);
  process.exit(1);
}

if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) stop(USAGE);
const dir = join(ROOT, "plugins", id);
if (existsSync(dir)) stop(`plugins/${id} already exists`);

const want = { screen: flags.includes("--screen"), api: flags.includes("--api"), tile: flags.includes("--tile") };
const sectionAt = flags.indexOf("--section");
const sectionFlag = sectionAt >= 0 ? flags[sectionAt + 1] : undefined;
if (sectionAt >= 0 && !want.screen) stop("--section places a screen in the rail; add --screen too.");
const isSection = (s: string | undefined): s is RailSection => RAIL_SECTIONS.some((r) => r === s);
if (sectionAt >= 0 && !isSection(sectionFlag)) stop(`--section must be one of: ${RAIL_SECTIONS.join(", ")}`);
const section: RailSection = isSection(sectionFlag) ? sectionFlag : "tools";

/** "zz-test" → "ZzTest" for code, "Zz test" for people. */
const Name = id.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());
const title = id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const files: Record<string, string> = {};

const contributes = [
  want.screen &&
    `    // A screen with a button in the rail. \`section\` groups it with screens like it, \`order\` places it within the
    // section (lower first), so the rail never depends on which plugin was added last.
    screen: {
      title: "${title}",
      summary: "One line for the rail tooltip and the command palette",
      glyph,
      section: "${section}",
      order: 50,
      view: () => import("./Screen"),
    },`,
  want.tile &&
    `    // A live tile on the Briefing, sorted by \`order\`, then title. Every viewer sees it until they hide it.
    tiles: [{ id: "${id}.tile", title: "${title}", order: 50, view: () => import("./Tile") }],`,
].filter(Boolean);

files["plugin.ts"] = `import { definePlugin } from "../../app/core/plugin";
${want.screen ? `import { glyph } from "./glyph";\n` : ""}
/**
 * The manifest. Every manifest loads at startup, so this file imports only definePlugin, constants from another
 * plugin's extension.ts (such as MAP_INK) and ./glyph. Views load on first use through () => import().
 * The registry finds this plugin by its folder: there is no list to add it to.
 */
export default definePlugin({
  id: "${id}",
  name: "${title}",
  description: "What this plugin adds, in one sentence.",
  contributes: {${contributes.length ? `\n${contributes.join("\n")}\n  ` : ""}},
});
`;

if (want.screen) {
  files["glyph.ts"] = `import type { Glyph } from "../../app/ui";

/**
 * The rail icon, kept as data so the manifest can carry it without loading React. Draw on a 24 px grid; strokes
 * have square caps and take the rail's colour. Paths are { d: "M…" }, circles are { circle: [cx, cy, r] }, and
 * \`fill: true\` makes a solid dot. This ring is a placeholder until you draw your own.
 */
export const glyph = [{ circle: [12, 12, 7] }, { circle: [12, 12, 1.4], fill: true }] satisfies Glyph;
`;
  files["Screen.tsx"] = `import type { ReactElement } from "react";
import { Page, Panel } from "../../app/ui";
import "./${id}.css";

/** Loaded only when the screen first opens. Handle loading, empty, error and permission-denied states here. */
export default function ${Name}Screen(): ReactElement {
  return (
    <Page eyebrow="${title}" title="${title}" lede="What this screen shows, in one sentence.">
      <Panel title="Panel">
        <p className="${id}-hello">Hello from ${id}.</p>
      </Panel>
    </Page>
  );
}
`;
  files[`${id}.css`] = `/* Every class here is "${id}" or starts with "${id}-", so plugins never collide (bun run check enforces it). */
.${id}-hello {
  color: var(--fog);
}
`;
}

if (want.tile) {
  files["Tile.tsx"] = `import type { ReactElement } from "react";
import { Stat } from "../../app/ui";

/** The tile body is a size container named "tile": adapt with @container tile (…), because a tile can be one or two columns wide. */
export default function ${Name}Tile(): ReactElement {
  return <Stat label="Value" value="42" />;
}
`;
}

if (want.api) {
  files["types.ts"] = `/** Payloads served by /api/${id}. Shared by api.ts (server) and client.ts (browser), so both sides agree on the shape. */
export interface ${Name}Status {
  ok: boolean;
}
`;
  files["api.ts"] = `import { defineSource, json } from "../../server/kit";
import type { ${Name}Status } from "./types";

/** Mounted at /api/${id}/… because of its folder. Validate upstream data here, once, with zod through fetchJson. */
export default defineSource({
  probes: [],
  routes: {
    "GET /status": () => json({ ok: true } satisfies ${Name}Status),
  },
});
`;
  files["client.ts"] = `import { api } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { ${Name}Status } from "./types";

/** usePoll pauses while the tab or the screen is hidden, so the API sees requests only while someone looks. */
export function use${Name}Status(): Polled<${Name}Status> {
  return usePoll((signal) => api<${Name}Status>("/api/${id}/status", { signal }), 30_000, []);
}
`;
}

await mkdir(dir, { recursive: true });
for (const [name, content] of Object.entries(files)) await Bun.write(join(dir, name), content);
// The dev server would notice the folder within two seconds; writing the registry now also updates editors and tsc.
await writeRegistry();

console.log(`Created plugins/${id}/ (${Object.keys(files).join(", ")}). No other file changed.`);
if (want.screen) console.log(`Its screen sits in the "${section}" section of the rail. Draw its icon in plugins/${id}/glyph.ts.`);
if (want.api) console.log(`Its API answers at /api/${id}/status once the server sees the folder.`);
