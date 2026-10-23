# VANTAGE architecture

VANTAGE is a small kernel plus a set of plugins. The kernel provides the server, the app shell, shared services and the design system. Each plugin is one folder in `plugins/` that adds features through named extension points. To add a feature, you add or change a plugin. You do not edit the kernel unless the feature needs a new kernel service.

```
┌──────────────────────────────── browser (app/) ────────────────────────────────┐
│  shell: rail · status bar · stage · feed ticker · profiler slot · palette · boot │
│  core:  plugin registry · nav + intents · feed · profile · things · location     │
│         settings · sound · api client · hooks · format · nearby · heading        │
│  ui:    Panel · Stat · Readout · Button · Toggle · ProfilerCard · Scramble · …   │
│                ▲ extension points (screen, tiles, commands, services, status,    │
│                │ profilers, profilerSections, nearby, + any point a plugin opens)│
│  plugins/<id>/plugin.ts  ── definePlugin({ contributes: { … } })                 │
│  plugins/registry.gen.ts ── generated from the plugin folders                    │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ fetch /api/<id>/…  (same origin)
┌───────────────────────────── server (server/, Bun) ─────────────────────────────┐
│  kernel: guard (localhost only) · router · /api/core (health, geocode, iploc)   │
│  kit:    json · parseQuery · memo · fetchJson (zod) · run · lines · ndjson · log │
│  plugins/<id>/api.ts ── defineSource({ routes, probes, assets })                 │
│                         auto-mounted at /api/<id>/… and /assets/<id>/…           │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │ HTTPS to public open data, or local commands
                          adsb.lol · CelesTrak · Open-Meteo · OpenStreetMap · …
```

## Folders

| Folder | Contains | May import |
| --- | --- | --- |
| `shared/` | Pure TypeScript used by both server and browser: geodesy math, kernel payload types | `shared/` and npm packages |
| `server/` | The server kernel: startup, request guard, plugin discovery, the kit for plugin APIs | `server/`, `shared/`, `scripts/registry.ts`, npm, Bun and Node built-ins |
| `app/` | The browser kernel: shell, core services, UI kit, styles | `app/`, `shared/`, npm, and `plugins/index.ts` |
| `plugins/<id>/` | One feature area, browser and server code together | See "Plugin boundaries" |
| `private/plugins/<id>/` | A second, gated plugin root (see "The private tree"); same shape as `plugins/<id>/`, and not part of the everyday app | See "The private tree" and `private/README.md` |
| `scripts/` | `check.ts` (architecture rules), `new-plugin.ts` (scaffold), `registry.ts` (writes the plugin registry) | anything |

`bun run check` enforces these rules together with the TypeScript type check.

### The registry

A plugin is a folder in `plugins/` with a `plugin.ts`. Nobody keeps a list of plugins. `scripts/registry.ts` writes `plugins/registry.gen.ts`, which imports every `plugins/*/plugin.ts` in alphabetical order. The file is git-ignored and is regenerated after `bun install`, as the first step of `bun run check`, when the server starts (also before a production build), and by the development server within two seconds of a plugin folder appearing or going. `plugins/index.ts` re-exports `plugins` and `PluginId` from it and stays the one import path for the kernel.

Because no shared file names the plugins, plugins added in parallel never conflict. Nothing depends on a plugin's position in the list: each plugin declares where its parts appear (see "Where things appear").

### Host and LAN features

Server mode is the default. A plugin declares a dependency on the host or LAN with a `local-only` file in its folder; the file explains the reason. `scripts/registry.ts` excludes it from the browser registry and `server/lib/router.ts` skips it before importing its API unless `VANTAGE_LOCAL=1`. These shared discovery paths own the flag so screens, tiles, services, settings, layers, probes and routes cannot disagree. Generated `PluginId` types still describe all normal plugin IDs so local plugin code remains type-checked in either mode.

The core IP-location route and its browser fallback also require local mode. Server mode discards a stored IP fix, omits the server start timestamp, and does not inspect Tailscale. Viewer GPS, camera, microphone and orientation remain available. A configured `VANTAGE_ORIGIN` enables the hosted listener and exact host/origin checks; it cannot be combined with local mode. See [deployment](DEPLOYMENT.md).

### The private tree

`private/plugins/` is a second plugin root with the same shape as `plugins/`, kept out of the everyday app. `scripts/registry.ts`, `server/lib/router.ts` and the development watcher add it only when both `VANTAGE_LOCAL=1` and `VANTAGE_PRIVATE=1`; a plain `bun run dev` or `bun run start` never imports, bundles, serves or hot-reloads it. `scripts/check.ts` walks it only with the flag set, so `bun run check` passes both ways. Nothing under `app/`, `server/`, `shared/` or `plugins/` may import the private tree. Read `private/README.md` before you open it: it holds work that steps past what VANTAGE does by default.

## Anatomy of a plugin

A plugin folder can contain these files. Only `plugin.ts` is required.

| File | Runs in | Purpose |
| --- | --- | --- |
| `plugin.ts` | browser | Manifest: `definePlugin({ id, name, description, contributes })`. The `id` equals the folder name. It loads at startup, so it imports at runtime only `definePlugin`, another plugin's `extension.ts` (for constants such as `MAP_INK`), `./glyph` and `./settings`. |
| `glyph.ts` | browser | The screen's rail icon, as data: `export const glyph = [{ d: "M2.5 20.5h19…" }, { circle: [12, 12, 1.4], fill: true }] satisfies Glyph;` |
| `settings.ts` | browser | The plugin's settings, as data: `export const settings = defineSettings("<id>", { … })`. Loads with the manifest, under the same import rule. See "Settings". |
| `api.ts` | server | `defineSource({ routes, probes, assets })`. Mounted at `/api/<id>/…` without registration. |
| `*.server.ts` | server | Server helpers that other plugins' `api.ts` may reuse, such as `grid/overpass.server.ts`. |
| `types.ts` | both | Payload types shared by `api.ts` and the browser code. Public. |
| `client.ts` | browser | Typed fetchers and hooks for this plugin's API. Public. |
| `extension.ts` | browser | Extension points this plugin opens for others, plus helpers for contributors. Public. |
| `*.tsx` | browser | Screens, tiles, layers, profilers. Private to the plugin. |
| `<id>.css` | browser | Styles. Every class is `<id>` or starts with `<id>-`. |

### Plugin boundaries

- Browser code in a plugin imports `app/core/*`, `app/ui`, `shared/`, its own files, and another plugin's public files only: `types.ts`, `client.ts`, `extension.ts`.
- Server code in a plugin (`api.ts`, `*.server.ts`) imports `server/kit.ts`, `shared/`, and any plugin's `types.ts` or `*.server.ts`.
- Plugins never import `app/shell/`, `server/lib/`, or another plugin's private files. Use intents, the feed, the profiler or a public file instead.

## Extension points

An extension point is a named key under `contributes`. Its owner reads it with `contributions("<point>")`, which returns every contribution from every plugin. TypeScript checks each contribution against the point's type, including points that plugins open.

| Point | Owner | What it adds | Example |
| --- | --- | --- | --- |
| `screen` | kernel | A full screen: a rail button in its `section`, a palette entry, an optional hotkey. `keepAlive` keeps it mounted after you leave it. | `screen: { title: "Sky", summary: "…", glyph, section: "world", order: 30, hotkey: "3", view: () => import("./SkyScreen") }` |
| `tiles` | kernel | A live tile on the Briefing. Every viewer sees it until they hide it. The tile body is a CSS size container named `tile`, so adapt with `@container tile (max-width: …)`. | `tiles: [{ id: "aircraft.traffic", title: "Air traffic around you", order: 20, view: () => import("./Tile") }]` |
| `commands` | kernel | A palette command (⌘K). `intent: { action }` opens the plugin's own screen with that action; `run` runs code; `arg` asks for a value first. Prefer `intent`, and never call `go()` in `plugin.ts`. | `commands: [{ id: "home.customize", title: "Customize the briefing", intent: { action: "customize" } }]` |
| `services` | kernel | A headless component mounted once at startup, for watchers that post to the feed. It keeps polling while the tab is hidden, at most once a minute (`HIDDEN_PERIOD_MS`). | `services: [{ id: "aircraft.watcher", view: () => import("./Watcher") }]` |
| `status` | kernel | An item in the top status bar. | `status: [{ id: "system.status", order: 20, view: () => import("./Status") }]` |
| `profilers` | kernel | The Profiler card for an entity kind. | `profilers: { aircraft: () => import("./AircraftProfile") }` |
| `profilerSections` | kernel | A section in every profile of one entity kind, whoever owns the kind. The view receives `{ entity }` of that kind and renders nothing when it has nothing to say. | `profilerSections: [{ id: "dossier.heritage", kind: "place", order: 30, view: () => import("./HeritageFact") }]` |
| `nearby` | kernel | Things to see or do near a position, for City's "Around me" mode. The module's default export is a provider `(query, signal) => Promise<NearbyItem[]>` that adapts data the plugin already fetches. See "Add something to Around me". | `nearby: [{ id: "places.nearby", title: "Landmarks", order: 10, refreshMs: 30 * 60_000, attribution: "Places: Wikipedia (CC BY-SA)", load: () => import("./nearby") }]` |
| `thingTypes` | kernel | One kind of thing on the City map that any number of sources can report: drinking water, public Wi-Fi, scooters. Declared once, by the plugin that owns the domain. Other plugins feed it. See "Several sources, one thing". | `thingTypes: [{ id: "water", title: "Drinking water", group: "services", tone: "ice", nearby: "find", description: "…", icon: () => import("./icons").then((m) => m.markSvg("water")) }]` |
| `settings` | kernel | The plugin's settings, shown on the Settings screen. Declare them in `settings.ts`; see "Settings". | `settings: Object.values(settings)` |
| `thingSources` | kernel | A source for any of the declared types. The module's default export is a provider `(query, emit, signal) => Promise<void>` that adapts data the plugin already fetches. The kernel merges the reports that mean the same thing. | `thingSources: [{ id: "dossier.nasoni", title: "Rome nasoni", types: ["water"], attribution: "…", load: () => import("./things-nasoni") }]` |
| `mapLayers` | `city` | A layer that draws itself: areas, lines, cones, anything beyond one marker per thing. For things that are one marker, declare a `thingTypes` entry instead, so other sources can join in. The view receives the MapLibre map and draws with `useGeoJsonLayer`, `useMapIcon` and `useMapView`. Marks the canvas cannot draw well, such as photos loaded from their source, are DOM markers kept in step with a list by `useDomMarkers`. `useMapIcon` takes SVG markup, a glyph or a lucide icon; `ringIcon` draws a registered icon inside a ring, tinted like it. `group` names a `mapLayerGroups` id. | `mapLayers: [{ id: "bikes.stations", title: "Bike share", group: "live", swatch: MAP_INK.mint, description: "…", view: () => import("./BikeLayer") }]` |
| `nearbyMapLayers` | `city` | A source-specific marker renderer for Around Me. Receives the in-view `items`, `selected` key, `map` and `choose(item)`; City keeps the off-screen pips. Reuse the domain’s map renderer. | `nearbyMapLayers: [{ source: "webcams.nearby", view: () => import("./NearbyCameraLayer") }]` |
| `mapLayerGroups` | `city` | A heading in the layer panel, over both layers and kinds of thing. City declares `live`, `hazards`, `weather`, `street-grid`, `services`, `knowledge` and `network`. A switch in an undeclared group appears under "Other"; `bun run check` names it. | `mapLayerGroups: [{ id: "reach", title: "Reach", order: 70 }]` |
| `mapControls` | `city` | A floating control on the City map, such as a time slider. The view receives the MapLibre map and the map's `mode` (`"map"` or `"around"`) and renders its own panel in the dock above the status line; the dock passes pointer events through, so only the panel takes clicks. Closed, a control is one small button: on a phone it shares a row with the map controls. Show it only in the mode where people need it; "Around me" keeps the map for what is near you. | `mapControls: [{ id: "timemachine.control", title: "Time machine", order: 20, view: () => import("./Control") }]` |
| `skyLayers` | `sky` | Targets on the Sky radar. The view is headless and reports azimuth and elevation for each target. | `skyLayers: [{ id: "aircraft.sky", title: "Aircraft", description: "…", swatch: "var(--sodium)", view: () => import("./AircraftSky") }]` |
| `skyPanels` | `sky` | A panel in the Sky screen's side column. | `skyPanels: [{ id: "satellites.passes", title: "Space station passes", order: 10, view: () => import("./PassesPanel") }]` |

Every `view` is a lazy loader, `() => import("./File")`, so a plugin's code loads only when it is first shown. Each view runs inside an error boundary. A crash shows a "stopped" message with a restart button and does not affect other plugins.

### Where things appear

Each plugin says where its parts go, so the result never depends on folder names or on which plugin was added last.

- **Rail.** Screens are grouped by `section`, in this fixed order: `here` (your surroundings at a glance), `world` (the public world outside), `signals` (what cameras, microphones and radio pick up), `yours` (your own Mac, network, devices and data), `tools`. Within a section, lower `order` comes first, then the title. Leave gaps (10, 20, 30) so a new screen fits between. The palette lists screens in the same order.
- **Briefing.** Tiles sort by `order`, then title. The viewer hides tiles in Customize mode; the choice is stored per browser, and a tile from a new plugin appears until the viewer hides it.
- **Ordered points.** `mapLayerGroups`, `mapControls`, `profilerSections`, `skyPanels` and `status` sort by `order`. `byOrder` in `app/core/plugin.ts` sorts by `order` (50 when unset), then title.
- **Everything else** (layers within a group, sky layers, commands, services) follows plugin order, which is alphabetical by folder.

### Opening a point of your own

A plugin opens a new extension point by augmenting the `Contributions` interface in its `extension.ts`:

```ts
// plugins/city/extension.ts
declare module "../../app/core/plugin" {
  interface Contributions {
    mapLayers?: MapLayerContribution[];
    mapLayerGroups?: MapLayerGroupContribution[];
  }
}
```

The owning plugin reads it with `contributions("mapLayers")`. Other plugins contribute to it exactly like a kernel point, and TypeScript checks the shape. Add the new point to the table above.

### Server extension types

`defineSource` accepts these keys. The kernel ignores keys it does not know, so a new server feature can be added the same way: add an optional key to `Source` in `server/lib/source.ts` and handle it in `server/lib/router.ts`.

| Key | What the kernel does |
| --- | --- |
| `routes` | Mounts `"GET /path"` and `"POST /path"` handlers at `/api/<id>/path`, behind the guard. |
| `probes` | Checks each URL for the boot screen and `/api/core/health`. |
| `assets` | Serves a folder at `/assets/<id>/<name>/…`, for example a library's web worker. The folder must sit inside one package in `node_modules` or inside the plugin's own folder. |

## Recipes

**A new plugin.** Run `bun run new tides --screen --section world --tile --api`. It creates `plugins/tides/` with a manifest, a placeholder glyph, a screen, a tile and an API, and edits no other file. The running development server shows it within two seconds. Draw the icon in `glyph.ts` on a 24 px grid.

**A map layer.** Contribute `mapLayers` from any plugin. The view gets `{ map, report }`, draws with `useGeoJsonLayer`, and calls `report({ loading, error, count })` for the layer panel. Use an existing group, or declare your own with `mapLayerGroups` when you add a family of layers. Name the layers that open something in `clickable` and handle them in `onClick(feature)`. City hands every click and tap to the nearest clickable feature: a mouse click reaches what lies under the pointer, a touch reaches 16 px around the fingertip. On a phone a tap on empty map opens nothing, and a long press drops a pin.

`useGeoJsonLayer` and `addMapLayers(map, specs, belowLabels)` share the draw order. The City style places all base labels after ground geometry, including 3D buildings. With `belowLabels: true` (or the helper's third argument `true`), data groups draw above ground in this order: rasters, filled areas, then paths. Other groups draw above base labels, with areas and lines below marker groups. Groups in each band sort by their first style-layer id, so toggling or lazy loading does not change their priority. Pass related layers together: their array order is preserved. Raster and image sources use `addMapLayers` from `city/extension.ts` after adding their source, and remove their layers and source on cleanup.

The camera comes first. `useMapView` reports a new view once the camera has rested for a moment, or within a second while the map follows you. While the camera moves, `useGeoJsonLayer` passes new data to the map at most four times a second; data that arrives while the camera rests lands at once. A layer that animates its marks hands each step to `useGeoJsonLayer` instead of calling `setData` itself, so the same limit applies. GeoJSON sources are cut into tiles down to zoom 13 and scaled up beyond it, so a mark is off by half a pixel at zoom 17 and by one at zoom 18. Never set React state on every `move`, `rotate` or `pitch` event: write per-frame readouts straight to the DOM, and keep in state only what changes the markup.

Marks fade in as they appear and out as they leave. For a GeoJSON layer, pass `fadeBy` with the feature property that names each mark, unique within the source and stable across refreshes (`fadeBy: "hex"`); it also serves as the feature id, in place of `promoteId`. The hook multiplies the opacity of the layer's circles, symbols, lines and fills by each mark's fade, and keeps a mark that left the data on the map until it has faded out. Extrusions take one opacity per layer, so they do not fade per mark. DOM markers from `useDomMarkers` fade without any option. Under reduced motion, marks appear and leave at once.

The ground is not always flat. City raises the terrain from Mapterhorn's elevation tiles unless the viewer turns off "3D terrain" in Settings. Lines, areas and rasters drape over the hills; circles, symbols, DOM markers and extrusions stand on them, so a height you give an extrusion or a `symbol-height-offset` counts from the ground under it, not from sea level. `map.project` and `map.unproject` already account for the terrain.

City marks the spot you look into in ice: when the context menu or a place profile is about a point, a reticle closes in on it and the building that stands there lights up. Do not draw a second marker for a place profile.

**A section on another plugin's profiler.** Contribute `profilerSections` with the entity `kind`, for example `"place"`, `"aircraft"` or `"satellite"`. The view is `({ entity }: ProfilerSectionProps<"place">) => …`. Head the section with a `v-eyebrow`, and return `null` while you know nothing, so the profile only grows where there is something to say. Every profiler built on `ProfilerCard` shows the section after its own content, without changes.

**A sky target.** Contribute `skyLayers`. The view is a headless component that receives `{ observer, report }` and calls `report(targets)` about once a second, each target with `az`, `el`, a `shape`, a `tone` and, if it can be profiled, an `entity`.

**A tile.** Contribute `tiles` with an `order` (lower comes first) and `span: 2` for a wide tile. Show loading, empty and error states inside the tile, and adapt to its width with `@container tile`. A tile that has nothing worth showing calls `useTileEmpty(true)` from `app/core/tile`; the Briefing hides its panel until it reports `false`, and Customize mode still shows it.

**A watcher.** Contribute `services` with a component that returns `null`, polls with `usePoll`, and posts notable events with `feed({ level, source, title, entity }, { key })`. The `key` keeps one event from repeating.

**Something to see or do near you.** Contribute `nearby` with a provider module. "Add something to Around me" is the full recipe.

**A kind of thing on the map.** Declare it once with `thingTypes` and feed it with a `thingSources` provider. A second plugin with its own records of the same kind adds a source and nothing else. "Several sources, one thing" is the full recipe.

**An extension point of your own.** In your `extension.ts`, define the contribution type and augment `Contributions`. Render `contributions("<point>")` where the feature appears, sort with `byOrder` if it has an `order`, and wrap each lazy view in `Boundary` and `Suspense`. Add a row to the table above.

## Add something to Around me

"Around me" is a mode of the City map that shows what is near you. Zooming in keeps at least the opening 1 km search radius; zooming out expands it up to 8 km. Things in view are markers on the map. Things within reach but off screen are pips on the edge of the map: each points the way and says how far. The list and map share five tabs, in this order: **Now · Go · Find · Do · See**. Now gathers live items and things starting within 15 minutes. Routine sensor readings stay in See; sensor warnings also appear in Now. Now initially shows at most six items, with up to two from each source. Show more reveals the rest in both the list and map. The other four tabs show one kind each without this display limit. OSM notes, communications towers, ground stations and counters start switched off; saved source choices take priority. Any plugin adds to Around me with a provider: one small file that turns data the plugin already has into items. The types and the merging hook `useNearby` are in `app/core/nearby.ts`.

A kind of thing on the map needs no provider: its `nearby` field names the tab, and City lists the nearest ones from every source that feeds it (`plugins/city/around-sources.ts`). Write a provider for what a kind of thing cannot say: departures, a live stream, a warning for your area, a reading from the nearest sensor.

### The manifest entry

```ts
// plugins/places/plugin.ts, inside contributes
nearby: [{ id: "places.nearby", title: "Landmarks", order: 10, refreshMs: 30 * 60_000, attribution: "Places: Wikipedia (CC BY-SA)", load: () => import("./nearby") }],
```

| Field | What it does |
| --- | --- |
| `id` | Unique; start it with your plugin id. Item keys are `<id>:<item id>`. |
| `title` | Names the provider under Sources, at the end of the list, where the viewer switches it off, and in its status line when it fails: "Landmarks: Wikipedia did not answer". A provider that is off is not asked. |
| `order` | Its place under Sources and among the status lines (50 when unset). It does not rank items. |
| `refreshMs` | How often the view asks again while it is shown. Default one minute. Use your source's cache time or longer. |
| `attribution` | The credit line on the map while the provider has items, as the source asks. |
| `load` | The module, loaded on first use, so the manifest stays light. |

### The module

The default export is a `NearbyProvider`: `(query, signal) => Promise<NearbyItem[]>`. The Wikipedia provider in `plugins/places/nearby.ts` is a complete example:

```ts
// plugins/places/nearby.ts
import { Landmark } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchArticlesNear } from "./client";
import type { Article } from "./types";

/** Exported on its own, so a test can feed it recorded data. */
export function articleItems(articles: readonly Article[], at: LatLon, radiusM: number): NearbyItem[] {
  return articles
    .map((a) => ({ a, d: distanceM(at, a) }))
    .filter((x) => x.d <= radiusM)
    .sort((x, y) => x.d - y.d)
    .slice(0, 8)
    .map(({ a }): NearbyItem => {
      const entity = { kind: "article", id: String(a.id), data: a } as const;
      return {
        id: String(a.id),
        title: a.title,
        detail: a.description ?? "Wikipedia article",
        kind: "see",
        at: { lat: a.lat, lon: a.lon },
        icon: Landmark,
        tone: "fog",
        ...(a.thumbnail ? { image: a.thumbnail } : {}),
        entity,
        primary: { label: "Read", run: () => profile.open(entity) },
        more: [{ label: "Walk there", run: () => import("../city/client").then((m) => m.routeTo({ lat: a.lat, lon: a.lon, name: a.title }, "foot")) }],
      };
    });
}

const nearby: NearbyProvider = async ({ at, radiusM }, signal) => articleItems(await fetchArticlesNear(at, Math.min(radiusM, 10_000), signal), at, radiusM);
export default nearby;
```

The query has three fields:

- `at`: where you are. It moves only after you walk a fifth of the radius (at least 100 m), so your fetchers and caches see the same position for a while. Distances in the list follow you anyway.
- `radiusM`: how far to look. It follows the map's zoom: 1 km at the zoom "Around me" opens at, doubling with each zoom level out, from 250 m to 8 km.
- `now`: the time of the question, in epoch ms.

`signal` aborts when the position or the radius changes or the view closes. Pass it to every fetch.

### What each item field does on screen

| Field | On screen |
| --- | --- |
| `id` | Stable within the provider. A chosen item stays chosen across refreshes, and only new ids play the entrance. |
| `title` | The row's title, the label next to a chosen marker, and the start of what a screen reader says for a marker or pip. |
| `detail` | The row's second line: "3 bikes (1 electric) · 5 docks", "64 to Termini, then 8". Leave the time out; the row adds it. |
| `kind` | Which tab lists it:<br>`"do"`: act on it now from the phone: listen to a microphone, tune a receiver, leave a map note, play a stream.<br>`"go"`: ways to move on: departures, bikes.<br>`"find"`: amenities: drinking water, toilets, Wi-Fi, defibrillators, chargers.<br>`"see"`: things to look at: landmarks, live cameras, sightings, reports, aircraft and stations overhead, old maps of the spot, warnings. |
| `at` | `{ lat, lon }`: a marker when in view, a pip when off screen, and the distance and walking time in the row. `"overhead"` (an aircraft, a satellite pass) or `"here"` (a warning for your area): the list only, shown as "Overhead" or "Here", counted as 0 m. |
| `icon` | A lucide-react icon component, a `Glyph` from your plugin, or SVG markup. Drawn in the item's tone on the marker, the pip and the row. |
| `tone` | `"mint"` available or healthy, `"sodium"` a live signal from outside, `"alarm"` danger or failure, `"fog"` anything else. Ice is not allowed: it marks you and the chosen item. |
| `startsAt` | When it happens or begins. The row shows "in 4 min", then "now". Without `until`, the item disappears one minute after this time. |
| `until` | When it ends. The row shows "until 18:40" while it lasts; the item disappears at this time. |
| `live` | Happening now with no end time: a live stream, an aircraft in the sky. The row shows "live". |
| `image` | A small picture for the row, with the icon as a badge. A URL from the source or a path on this server. |
| `entity` | Choosing the item, from its row or its marker, opens this profile. |
| `primary` | The button on the row: one tap. |
| `more` | More buttons, shown under the row while the item is chosen. |

An action is `{ label }` plus one of:

- `intent: { screen, action, arg? }`: opens that screen and asks it to act, as `go()` does. Example: `{ label: "Listen", intent: { screen: "listen", action: "nearest" } }`.
- `href`: opens a page outside VANTAGE in a new tab. Use a fixed URL, or one the server checked with `webUrl` when it came from a feed.
- `run`: runs code. Load anything heavy inside it with `import()`. If the promise rejects, a toast says "<label> did not work" with the reason.

Name the action in plain words: "Walk there", "Listen", "Show it". Name the primary for what the kind is for ("Departures", "Show bikes", "Watch", "Listen", "Read"). "Walk there" goes in `more`, except for Find, where walking there is the point.

### How the tabs are decided, and the order

- Go, Find, Do and See each list the items of one `kind`: Go ways to move on, Find amenities, Do things to act on from the phone, See things to look at.
- Now lists items of any kind that are happening now or start soon:
  - now: `live` is true; or it has begun and is not over (`startsAt` passed, within `until` or the minute after); or it has only an `until` that has not passed.
  - soon: `startsAt` is within the next 15 minutes.
- On the map, the marker of something happening now carries a slow ring, which rests with the motion policy.
- Before sorting, the hook drops items that are over, drops positioned items beyond the radius, and measures distance and direction from your current position.
- Then it sorts, in this order:
  1. distance, in bands of walking time at 80 m a minute: under 2 minutes, 5, 10, 20, 40, and further;
  2. within a band, urgency: now, then soon, then the rest;
  3. exact distance;
  4. the earliest `startsAt`;
  5. title.
- It keeps the first 60 items.

`placeNearby` and `compareNearby` in `app/core/nearby.ts` hold these rules, and `app/core/nearby.test.ts` checks them.

### Rules

- **Reuse what your plugin already fetches.** Call its `client.ts` fetchers, its API routes that cache with `memo` or `diskMemo`, or a store that a watcher keeps fresh (the aircraft provider reads `useTraffic`). Do not add a route or an upstream request for "Around me".
- **No new upstream load per tick.** Set `refreshMs` to your server's cache time or longer, so a refresh is answered from the cache.
- **Return quickly and keep it short.** Return the nearest few of each kind (three to eight). Cache heavy work in the module, as the satellites provider does with its passes for an hour. A provider that has not answered within 30 s counts as failed for that round.
- **Nothing near is not an error.** Return `[]`. Throw when the source fails: the view keeps your previous items and shows "<title>: <reason>" quietly under the list, and the other providers carry on. When you combine sources, use `Promise.allSettled` and throw only when all of them fail.
- **Keep the module quiet at import.** Do not import modules that touch the window when they load, such as `feed` or `sound`. Load `city/client` (for `routeTo`) inside `run` with `import()`. This also keeps the adapter testable with `bun test`.
- **Copy.** Plain and specific: say what it is, and leave distance and time to the row. Show names and identifiers as the source publishes them. Do not write copy that says data is public, legal or not hacked.

### Test a provider

Export the adapter as a pure function, record one real answer of your route, and test the adapter with it:

```sh
curl -s "http://127.0.0.1:4747/api/bikes/near?lat=50.847&lon=4.353" > plugins/bikes/fixtures/near-brussels.json
```

```ts
// plugins/bikes/nearby.test.ts
import { expect, test } from "bun:test";
import recorded from "./fixtures/near-brussels.json";
import { bikeItems } from "./nearby";
import type { BikesNear } from "./types";

test("lists the nearest stations with a bike, nearest first", () => {
  const items = bikeItems(recorded satisfies BikesNear, { lat: 50.8467, lon: 4.3525 }, 1000);
  expect(items.map((i) => i.title)).toEqual(["PLACE SAINT-JEAN / SINT-JANSPLEIN", "AGORA", "GARE CENTRALE / CENTRAAL STATION"]);
});
```

Trim the recording to what the test needs. Test what your adapter decides: what it keeps, the radius, the order, unique ids, tones and wording. Run `bun test plugins/<id>`, then `bun run check`. To see it in the app, open City and choose Around me, or run "What's around me" from the palette (⌘K).

## Several sources, one thing

Open data says the same thing twice. A drinking fountain is in OpenStreetMap and in the city's own register. A Wi-Fi
hotspot is mapped by volunteers and logged by the city that runs it. Drawing a layer per source gives the viewer two
switches, two markers a few metres apart, and no way to see that the two records are one fountain.

A **kind of thing** fixes that. One plugin declares the kind once with `thingTypes`; every plugin that can find one
contributes a `thingSources` entry. The kernel (`app/core/things.ts`) asks the sources, recognises the reports that
mean the same thing, and merges them into a `FusedThing` that keeps each source's own facts and actions. The layer
panel shows one switch per kind, with its sources folded underneath.

Types and sources are independent. A source feeds any subset of the types; a type takes any number of sources; a city
with a dataset of its own joins in by adding a source, and nothing else changes.

### Declare the kind

```ts
// plugins/grid/plugin.ts, inside contributes
thingTypes: [
  { id: "water", title: "Drinking water", group: "services", tone: "ice", order: 14, nearby: "find",
    description: "Free drinking fountains and refill points, from every register that lists them.",
    icon: () => import("./icons").then((m) => m.markSvg("water")) },
],
```

| Field | What it does |
| --- | --- |
| `id` | Shared vocabulary, so another plugin can feed it: a plain lowercase word such as `water` or `wifi`, not a plugin-prefixed id. |
| `title` | The switch in the layer panel, and the name of a thing no source gave one. |
| `group` | A `mapLayerGroups` id: the heading it appears under, beside the layers. `bun run check` catches a typo. |
| `description` | One sentence for the panel: what this is. Each source credits its own data. |
| `tone` | `ice`, `mint`, `sodium`, `alarm`, `bone` or `fog`: the colour of the marker and the swatch. |
| `icon` | `() => Promise<ThingIcon>`: SVG markup, a glyph, or a lucide icon, loaded with the map. |
| `variants` | Icons for the `variant` a thing may name, when one switch covers a few shapes: police, fire and hospital under "Police, fire, hospitals". |
| `order` | Its place in its group (50 when unset). Layers in the same group keep plugin order. |
| `nearby` | The "Around me" tab that lists the nearest three within 1 km (`"go"`, `"find"`, `"do"` or `"see"`), or `false` for a kind that means nothing to someone walking by. Every source of the kind feeds it, and a source switched off on the map stays off there. |
| `defaultOn` | On until the viewer switches it off. |
| `minZoom` | Show this kind on the map only at or above this zoom, across all sources. The panel says "zoom in" below it. Nearby search does not use this display threshold. |
| `mergeM` | How close two reports with no identifier in common must stand to mean the same one. Default 25 m. Narrow it for a kind that stands close together. |

### Add a source

```ts
// plugins/dossier/plugin.ts, inside contributes
thingSources: [
  { id: "dossier.nasoni", title: "Rome nasoni", types: ["water"], refreshMs: 6 * 3_600_000,
    attribution: "Nasoni: © OpenStreetMap contributors", load: () => import("./things-nasoni") },
],
```

| Field | What it does |
| --- | --- |
| `id` | Unique; start it with your plugin id. |
| `title` | Names the source under the kind it feeds, in the panel and in the profile: "Rome nasoni". |
| `types` | The declared type ids it can provide. `bun run check` catches a typo. |
| `attribution` | The credit on the map while it has things on screen, as its terms ask. |
| `minZoom` | Stay quiet below this zoom, for a source that answers per area. The panel says "zoom in" when every source of a kind is out of zoom. |
| `refreshMs` | How often to ask again while the map is open. Default five minutes. Use your cache time or longer. |
| `order` | Its place in the source list, and which source leads a merge (its name and id go on the fused thing). |
| `load` | The module, loaded on first use, so the manifest stays light. |

### The module

The default export is a `ThingProvider`: `(query, emit, signal) => Promise<void>`. Call `emit` with what you have, as
often as you like; a slow source fills the map while it works. Resolve when you have nothing more to add. The query
carries `box`, `center`, `zoom`, the `types` the view wants, and `now`.

```ts
// plugins/dossier/things-nasoni.ts
const nasoni: ThingProvider = async ({ box }, emit, signal) => {
  if (!overlapsRome(box)) {
    emit([]);
    return;
  }
  const { fountains } = await fetchNasoni(signal);
  emit(nasoneThings(fountains).filter((t) => inside(box, t.at)));
};
export default nasoni;
```

A `Thing` is `{ id, type, name, at, match }` plus what the source knows:

| Field | What it does |
| --- | --- |
| `name` | Its own name, as on a sign or in a register: "Sint-Pieters". `null` when it has none. A word for what it is goes in `label`, because two different fountains both answer to it. |
| `label` | What to call it when it has no name: "Drinking fountain", "Police station". The type's title stands in otherwise. |
| `match` | Every identifier the record carries in a register other sources share, written `<scheme>:<value>`: `osm:node/123`, `wikidata:Q42`, `uic:8814001`, `evse:BEALLE123`. Required; `[]` only when the record has none. `shared/thing-ids.ts` writes the common schemes one way. |
| `detail` | One short line under the name: "Cast-iron street fountain", "12 sessions on 2026-10-09". |
| `state` | `ok`, `low`, `out` or `unknown`, where the source knows: a scooter's battery, a station's bikes. `low` paints the marker amber, `out` red. The worst any source reports wins. |
| `variant` | Names an entry in the type's `variants`, for a type that covers a few shapes. |
| `rows` | `[label, value]` pairs: what this source knows, under its name in the profile. |
| `actions` | What this source lets you do: rent it, open its page, correct its record. `{ label, href }`, `{ label, intent }` or `{ label, run }` — see `app/core/action.ts`. |
| `fact` | One sentence worth knowing about this kind of thing. |
| `image` | A picture for the profile. |

### How two reports become one

Identifiers decide first; position is the fallback.

1. **A shared identifier.** Reports of one type that share a `match` identifier are one thing, however far apart their
   sources put it. A report that carries two codes joins the reports that carry either.
2. **Position, for the rest.** Pairs of reports within the type's `mergeM` are tried nearest first, so a report joins
   the closest candidate rather than whichever turned up first. Two groups join only when every report in one stands
   within `mergeM` of every report in the other, so a row of fountains never chains into one. Nothing may contradict
   the join: names that differ once case, accents and punctuation are dropped; different variants (a police station
   beside a fire station); or different codes in one register (`osm:node/1` against `osm:node/2`). A missing name or
   code says nothing either way.

Two reports from one source are never merged: a source that lists a fountain twice means two fountains. The fused
thing sits at the mean of the positions its sources report, takes the first name any source gives, then the first
label, and the marker carries a second ring when more than one source found it. `fuseThings` in `app/core/things.ts`
holds these rules, and `things.test.ts` checks them.

The profile shows each source's own rows under its own name, so nothing is flattened away, and the actions of every
source, in source order. Any plugin can add to it with a `profilerSections` entry for the `thing` kind: `bikes`
shows what an operator charges, `dossier` the language mix of a Rome hotspot.

### Rules

- **Reuse what your plugin already fetches.** Call its `client.ts` fetchers and its routes that cache with `memo` or
  `diskMemo`. Do not add a route or an upstream request for the map.
- **Publish every identifier the record carries.** An OpenStreetMap reference, a Wikidata item, a station or charge
  point code: each one lets another source find the same thing without guessing from the position. Keep the codes when
  your server reads the record, and write them with the helpers in `shared/thing-ids.ts`.
- **A name is a name.** Put a generic word ("Nasone", "Toilets") in `label`, never in `name`: a name that every
  fountain shares would keep two reports of one fountain apart, or join two different ones.
- **Answer for the view, not for the world.** Filter to `box`, and return early when the view is outside the area your
  records cover. A source for one city stays silent everywhere else.
- **Emit as you go.** A source that reads tiles emits after each one. The sources run only while the City map is in
  Map mode; the kernel keeps the last answer while the next one loads.
- **Nothing found is not an error.** Emit `[]`. Throw when the source fails, and only when every part of it failed:
  the panel then says "error" and names the problem in the switch's tooltip.
- **Credit the source and name it plainly.** `title` is what the viewer reads under the kind: "OpenStreetMap",
  "Rome nasoni", "Operators' GBFS feeds".

### Test a source

Export the adapter as a pure function and test what it decides — what it keeps, the names, the rows, the state, the
actions:

```ts
test("renting is offered only where the operator publishes a link for it", () => {
  expect(vehicleThings([vehicle()])[0]?.actions).toEqual([]);
  expect(vehicleThings([vehicle({ rentalUrl: "https://tier.app/rent/abc" })])[0]?.actions).toEqual([{ label: "Rent now", href: "https://tier.app/rent/abc" }]);
});
```

## Settings

A plugin declares its settings as data in its own `settings.ts`, and the Settings screen draws them. Nothing else changes: no screen code, no store.

```ts
// plugins/traffic/settings.ts
export const settings = defineSettings("traffic", {
  flowPalette: { kind: "choice", group: "Traffic flow", title: "Colours", options: [{ value: "signal", label: "Signal", swatches: [MAP_INK.alarm, MAP_INK.sodium, MAP_INK.mint] }, …], default: "signal" },
  flowFree: { kind: "toggle", group: "Traffic flow", title: "Free-flowing roads", description: "Turn off to draw only slow roads.", default: true },
  flowWidth: { kind: "range", group: "Traffic flow", title: "Line width", min: 0.5, max: 2, step: 0.1, default: 1, unit: "×" },
});
// plugins/traffic/plugin.ts
contributes: { settings: Object.values(settings) }
// any component of the plugin
const palette = useSetting(settings.flowPalette); // "signal" | "ember" | "ice"
```

- **Kinds.** `toggle` (a switch), `choice` (one option; short bare options draw as a segmented control, options with a `description` or `swatches` as cards), `set` (any number of options, as chips) and `range` (a slider; the stored number is the one shown, followed by `unit`).
- **Values** are kept per browser in `localStorage`. `useSetting` returns a value typed from the field's options. A stored value that no longer fits the field, such as an option a later build removed, reads as the default.
- **Grouping.** `group` adds a sub-heading inside the plugin's panel. A map layer that a group styles names it in `settings`, and the layer panel shows a shortcut that opens the Settings screen at that group: `go("settings", { action: "<plugin id>", arg: "<group>" })`.
- **Outside React**, read a value with `readSetting(field)`.

## Entities and the Profiler

An entity is a reference to one thing that can be profiled: a place, an aircraft, a satellite, a device on your network. Its type is `{ kind, id, data }`. The kernel owns the `place` kind. Plugins add kinds by augmenting `EntityKinds`:

```ts
declare module "../../app/core/plugin" {
  interface EntityKinds {
    aircraft: AircraftRef;
  }
}
```

Any code opens a profile with `profile.open(entity)`. The shell finds the plugin that contributed a profiler for that kind and renders it in the profiler slot at the top right. Profilers use `ProfilerCard` from the UI kit so every profile looks and animates the same way. The slot also renders the `profilerSections` contributed for that kind and hands them to the card, which shows them after the profiler's own content. Each section loads and fails on its own.

## How plugins talk to each other

- **Intents** open a screen and ask it to do something: `go("net", { action: "trace", arg: "1.1.1.1" })`. The screen handles it with `useIntent("net", handler)`.
- **The feed** records events: `feed({ level, source, title, detail, go?, entity? }, { key?, toast? })`. Events appear in the ticker and the feed log. Clicking an event follows its `go` intent and opens its `entity`.
- **The profiler**: `profile.open(entity)` from anywhere, and `profilerSections` to add to another plugin's profiles.
- **Public files**: `types.ts`, `client.ts` and `extension.ts` of another plugin.

## Data flow for public data

1. A plugin's `api.ts` fetches the upstream with `fetchJson(source, url, zodSchema)`. The schema validates the response once. A mismatch becomes an HTTP 502 that names the source.
2. The handler normalizes the data into a type from the plugin's `types.ts`, caches it with `memo(key, ttlMs, load)`, and returns `json(data)`. `memo` shares one request between concurrent callers and serves the previous value if a refresh fails.
3. The plugin's `client.ts` wraps the route in a hook built on `usePoll(load, intervalMs, deps)`. `usePoll` pauses while the browser tab is hidden or while its screen is mounted but not shown (a `keepAlive` screen in the background), and keeps the last good data when a refresh fails. The kernel's clocks and frame loops (`useNow`, `useInterval`, `useAnimationFrame`, `useMotionNow`) stop there too.
4. Views render the hook's `data`, `error` and `loading` states.

`diskMemo(key, ttlMs, load, shape, staleMs?)` keeps a value in `.cache/` as well, so a large, slow-changing file survives a restart. What it reads back was written by an earlier run, which may have been an earlier build of VANTAGE, so `shape` is a zod schema for the stored value and it is required: a stored value that no longer fits the fields the code expects is read from the source again, instead of coming back short, and a file that is not readable JSON counts as absent. Reuse the schema the loader already has where the stored value is its output (`z.array(Station)`), and declare one next to the loader otherwise. TypeScript checks the schema against the loader's return type, so a field added later cannot be forgotten.

Both `memo` and `diskMemo` measure age from the successful source load. Reading from disk or serving a failed refresh's fallback does not restart that clock. A value stays fresh for `ttlMs`; after that, callers wait for one shared refresh. If it fails, the cache can return a value whose **total age** is less than `staleMs` (default: ten times the TTL). Set `staleMs` to the TTL when older data must not be served, as with satellite orbital elements after their usable window. A failure pauses retries for the shorter of the TTL and one minute, but never extends the stale window. Each key must identify one loader and value type. The memory values and remembered errors each have a limit of 2,000 entries; expired entries are pruned once a minute.

Disk writes use a temporary file and rename it after the full record is written. A write failure is logged, and the successful source response remains available in memory. Existing short, lowercase filenames remain usable; keys with punctuation, uppercase letters or more than 180 characters use a separate SHA-256 filename namespace. Ambiguous old filenames are not reused for those keys.

## Security

- Without `VANTAGE_ORIGIN`, the server binds to `127.0.0.1`. A hosted origin binds to `0.0.0.0` with local features disabled and permits its exact host and origin. The guard refuses requests whose `Host` header is not `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding), requests marked `Sec-Fetch-Site: cross-site`, and requests with a foreign `Origin`. POST bodies must be JSON and carry `x-vantage: 1`. A browser cannot send either cross-site without a preflight, and a server-side request that a hostile redirect turns back at the API never carries the header.
- No other page may frame the app: production sends `frame-ancestors 'none'` and `X-Frame-Options: DENY`, and the app refuses to start inside a frame.
- URLs from third parties are fetched with `fetchPublic`, which allows only http(s) and refuses private, loopback and IPv4-embedding IPv6 addresses at every redirect.
- Local commands run through `run()` and `lines()` with argument arrays. No shell interpolation.

## Design system

- Tokens live in `app/styles/tokens.css`. Signal colours have fixed meanings: ice for you and your selection, sodium for live signals from the outside world, alarm for surveillance and failures, mint for healthy states.
- Fonts: Big Shoulders (display, commissioned by the City of Chicago), IBM Plex Sans (interface), IBM Plex Mono (data).
- Use the UI kit in `app/ui` before writing new components. `Page` gives a non-map screen its standard header and entrance animation.
- On phones, anything that rises from the bottom is a `Sheet` from `app/ui`. It sits above the feed ticker and the tab bar and rests at the `snaps` you give it: `peek` (its header and the first row), `half` and `full`. Its header drags it, and so does its content when scrolled to the top and dragged down; the content scrolls at every snap point. The handle is a button that steps through the snaps. With `onClose` it is modal, with a scrim. The snapping rules are pure functions in `app/ui/sheet-snap.ts`.
- `useHeading(active)` from `app/core/heading.ts` gives the compass heading, smoothed and at most 15 updates a second. `useOrientation(active)` shares its listener and gives the screen's right, up and forward axes in east/north/up coordinates; forward points through the back of the phone. `useCompass` owns the shared `enabled` preference, controlled from Map or Sky. `requestCompass()` asks for permission from a tap where the browser requires it (iOS). Nothing listens while orientation is off, no view is active or the page is hidden. Use phone-relative directions only with a GPS location, because a pinned or internet position is not where the phone stands.
- Screen glyphs are data in each plugin's `glyph.ts`; `app/ui/glyphs.tsx` holds only the renderer and the VANTAGE mark.
- Motion uses `motion/react` springs with `bounce: 0`. Sounds come from `sfx` in `app/core/sound.ts`. Both respect the user's settings and reduced-motion preference.
- The motion policy (`app/core/motion.ts`) keeps an untouched window nearly free. Ambient loops rest while the page is hidden, after two minutes without pointer, key, wheel or touch input, and under reduced motion. At rest the root gets `data-motion="rest"`, which turns `--v-loop` to `paused`, so every CSS loop that ends its `animation` with `var(--v-loop)` holds its phase and resumes without a jump. JS loops ask the same policy: `useAnimationFrame` (an "ambient" or "data" loop; at rest it draws one still frame per render; it passes `dt`, the loop's own `clock` for phases, and the frame's `now` on the `performance.now()` timeline for comparing with stamps taken elsewhere), `useMotionNow` for dead reckoning between polls, and City's `useMapPulse`, which writes map paint properties at about 30 Hz. Data-driven motion still plays once when the data changes.
- A plugin that plays a long-running stream calls `claimSpeaker(id, stop)` from `app/core/speaker.ts` when it starts and `releaseSpeaker(id)` when it stops. Starting one stream stops the other, so plugins never need to know about each other's audio.
