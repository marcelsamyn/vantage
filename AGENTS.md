# Working on VANTAGE

VANTAGE is a local, Watch Dogs–inspired city dashboard. Read `docs/ARCHITECTURE.md` before changing code. This file lists the rules for contributors and coding agents.

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev` | Start the server on http://127.0.0.1:4747 for development. The browser hot-reloads; the server starts fresh when server code changes. Bun's development server serves pages only to localhost. Set `PORT` to use another port. |
| `bun run start` | The everyday app: build a split, minified bundle, serve it, and rebuild when a file changes. Use this to open VANTAGE from your phone through Tailscale Serve. |
| `bun run check` | Regenerate the plugin registry, type-check, enforce the architecture rules and run the tests. Run it before you report work as done. |
| `bun run test` | Run the tests only (`*.test.ts` next to the code they test). |
| `bun run new <id> [--screen [--section <section>]] [--tile] [--api]` | Scaffold `plugins/<id>/`. No other file changes. `--section` places the screen in the rail (default `tools`). |

Use Bun only. Do not use npm, yarn or pnpm. Add a dependency with `bun add <pkg>`.

Host and LAN features require `VANTAGE_LOCAL=1`. A plugin that reads or controls the server host or its LAN must have a `local-only` file explaining why. Discovery excludes these plugins before imports in server mode. A hosted `VANTAGE_ORIGIN` cannot be combined with local mode. See `docs/DEPLOYMENT.md` for Docker and Swarm.

## Where code goes

- A new feature is a plugin, or a change to one plugin. Keep everything about one domain (aircraft, Wi-Fi, weather) in one folder.
- There is no registration step. A folder in `plugins/` with a `plugin.ts` is a plugin: `plugins/registry.gen.ts` is generated from the folders and is not checked in. Never add a plugin to a list, and never edit the generated file.
- A plugin declares where its parts appear. A screen sets `section` (`here`, `world`, `signals`, `yours` or `tools`) and `order` (lower first, in steps of 10) for its rail place. Tiles, layer groups and profiler sections set `order`. Nothing depends on a plugin's position in a list.
- To add to another plugin's feature, contribute to its extension point instead of editing it: `profilerSections` for a section on any profile, `mapLayerGroups` for a new heading in the layer panel. `docs/ARCHITECTURE.md` lists every point with an example.
- Several sources often publish the same kind of thing. Declare the kind once with `thingTypes`, and add a `thingSources` provider for each set of records, including a city's own. Publish every identifier a record carries in `match` (OpenStreetMap, Wikidata, station and charge point codes): the kernel merges reports by identifier first and by position only as a fallback; see "Several sources, one thing" in `docs/ARCHITECTURE.md`. Write a `mapLayers` layer only for what draws itself: areas, lines, cones.
- To add things to Around me, see "Add something to Around me" in `docs/ARCHITECTURE.md`.
- Change `app/`, `server/` or `shared/` only for a service that several plugins need. Explain the reason in your report.
- A choice the viewer makes about how a plugin looks or behaves is a setting: declare it in the plugin's `settings.ts` with `defineSettings` and read it with `useSetting`. The Settings screen shows it without other changes. See "Settings" in `docs/ARCHITECTURE.md`.
- Payload types go in the plugin's `types.ts`. Fetchers and hooks for the plugin's API go in `client.ts`.
- Keep `plugin.ts` light. It loads at startup, before plugins are installed, so it imports at runtime only `definePlugin`, another plugin's `extension.ts` (for constants such as `MAP_INK`) and its own `./glyph` and `./settings`; type-only imports are free. `bun run check` enforces this. Load code with `() => import("./File")`, including code a command runs: `run: () => void import("./nearest").then((m) => m.findNearest("aed"))`. Never call `go()` in `plugin.ts`; use `intent` commands.

## Code rules

- TypeScript strict mode. Give exported functions explicit return types. Use `unknown` rather than `any`. Prefer `satisfies` to casts.
- Validate every external response once, in `api.ts`, with zod through `fetchJson` or `parseUpstream`. After that, trust the type.
- Throw `HttpError` for expected failures. Do not catch errors only to hide them. The kernel turns errors into JSON responses, and the browser shows them through `Empty` or the layer status.
- Run local commands with `run([...args])` or `lines([...args])` from the kit. Never build a shell string.
- Fetch a URL that came from a third party (a pasted link, a directory entry) only through `fetchPublic` from the kit, which refuses private addresses at every redirect. Never fetch a URL the browser sends; take an id and look the URL up on the server.
- Read POST bodies with `parseBody`; send them from the browser with `post()`. The server refuses a POST without `content-type: application/json` and `x-vantage: 1`; add both when you test with curl.
- A server-side fetch to a device or service must not follow redirects unless every hop is checked: use `fetchPublic` for third-party URLs and `redirect: "error"` for devices on the user's network.
- Cache upstream calls with `memo` or `diskMemo`. `diskMemo` needs a zod `shape` for what it stores, because a file written by an earlier build must not come back as a record it no longer matches; reuse the loader's own schema where the stored value is its output. Respect each public API's rate limit and send no more requests than the screen needs.
- CSS: one plain `.css` file per plugin, imported by its components. Every class is `<id>` or starts with `<id>-`. Do not use CSS modules: Bun's dev server leaves their bindings undefined in lazily loaded code.
- Use design tokens (`var(--ice)`, `var(--s4)`, …) and the UI kit (`app/ui`). Use `MAP_INK` for colours on the map.
- Add map style layers with `useGeoJsonLayer` or `addMapLayers` from `city/extension.ts`. The helper keeps raster overlays, areas and paths above ground geometry and below base labels, with markers above labels. Pass related style layers together to preserve their internal order. Do not choose the first symbol layer as an insertion anchor or use `moveLayer` to set plugin priority.
- Give a GeoJSON layer of markers `fadeBy` with the property that names each mark (unique and stable), so markers fade in and out. Do not call `setData` on a source the hook owns.
- Icons come from `lucide-react` at `size` 13–16, except screen glyphs. A screen's glyph is data in its plugin's `glyph.ts` (paths and circles on a 24 px grid, `satisfies Glyph`). `app/ui/glyphs.tsx` holds only the renderer and the VANTAGE mark; do not add glyphs there.
- Write comments that explain why. Do not leave TODOs, stubs or commented-out code.
- Looping motion that carries no information (pulses, sweeps, glows) follows the motion policy in `app/core/motion.ts`: it runs only while the page is visible and someone used it in the last two minutes. End an infinite CSS animation with `var(--v-loop)` (`animation: x 2s linear infinite var(--v-loop)`; `bun run check` enforces it) and animate only `transform` and `opacity`. In JS, use `useAnimationFrame` (ambient by default, `"data"` for live audio or video), `useMotionNow` to move things between polls, and `useMapPulse` for map pulses. They stop while the page is hidden; a raw `requestAnimationFrame` loop or `setInterval` clock does not.

## Interface rules

- Every screen handles loading, empty, error and permission-denied states with a message that says what happened and what to do next.
- Copy is plain and specific. Buttons name their action ("Run speed test", not "Submit").
- Do not write copy that says data is public, legal or not hacked. Say what the user sees and can do.
- Numbers that update use `.num` or tabular numerals. Use `fmt` from `app/core/format.ts` for units, and respect the user's metric or imperial setting.
- Use `ProfilerCard` for any "details about one thing" view, and open it with `profile.open(entity)` so it appears in the shared profiler slot.
- Push notable events to the feed with `feed()`. Use a `key` to avoid repeats. Use `toast: true` only for events that need attention now.

## Public data

Show everything a source publishes that a viewer could find interesting: names, usernames, owners, callsigns, registrations, avatars, profile links, photos of people, descriptions and exact positions. Do not drop, blur or round fields to hide people. Credit the source and link back where its terms ask for it. Make names, callsigns, registrations and other identifiers clickable when a page about them exists, and show a picture when a source offers one.

## Scope

VANTAGE reads public open data and the user's own devices, and it acts on this Mac and on the devices discovery finds on the user's own network. Anything with a side effect asks first, such as a Shortcut or a Blackout.

The tree in `private/` is not part of that app. It holds plugins that step past this boundary into unfriendly territory — probing devices nobody owns, and acting on what answers. A plain build never imports, bundles or serves `private/`. Read `private/README.md` before you open that tree, and do not reference it from `app/`, `server/`, `shared/` or `plugins/`.

## Verifying work

1. `bun run check` passes.
2. The server starts and the new routes answer: `curl -s http://127.0.0.1:<port>/api/<id>/...`.
3. The screen renders without console errors at desktop size and at 375 px wide.
4. Report the commands you ran and their output.
