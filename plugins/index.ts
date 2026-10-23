/**
 * The installed plugins, and `PluginId`, the union of their ids. The kernel imports plugins only through this file.
 *
 * A plugin is a folder in plugins/ with a plugin.ts whose id equals the folder name. There is no list to edit:
 * scripts/registry.ts generates registry.gen.ts from the folders (on `bun install`, `bun run check`, server start,
 * and in development whenever a plugin folder appears). Where a plugin shows up is declared by the plugin itself:
 * `screen.section` and `screen.order` place it in the rail, a tile's `order` places it on the Briefing.
 */
export { plugins, localEnabled, type PluginId } from "./registry.gen";
