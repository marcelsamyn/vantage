import { HttpError, memo, run } from "../../../server/kit";
import { deviceOf, type Act, type Driver, type Endpoint } from "../driver.server";
import type { ChoiceOption, Device } from "../types";

/**
 * The user's Shortcuts, through the `shortcuts` command. This is how VANTAGE reaches HomeKit scenes and anything
 * else the user has automated. A shortcut runs by its identifier, and only if it is in the current list.
 */

const KEY = "shortcuts";
/** Shortcuts can wait on the network or on other apps; give them time before calling a run failed. */
const RUN_TIMEOUT_MS = 120_000;

/** `shortcuts list --show-identifiers` prints "Good night (0C6A…-…)" per line. */
export function parseShortcuts(output: string): ChoiceOption[] {
  const options: ChoiceOption[] = [];
  for (const line of output.split("\n")) {
    const m = /^(.*) \(([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})\)$/i.exec(line.trim());
    if (m?.[1] && m[2]) options.push({ id: m[2], label: m[1] });
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

const listShortcuts = async (): Promise<ChoiceOption[]> => parseShortcuts(await run(["shortcuts", "list", "--show-identifiers"]));

export const runArgs = (identifier: string): [string, ...string[]] => ["shortcuts", "run", identifier];

export const shortcuts: Driver = {
  id: "shortcuts",

  async discover(): Promise<Endpoint[]> {
    return [{ key: KEY, driver: "shortcuts", kind: "automation", name: "Shortcuts", group: "On this Mac", local: true, url: null, meta: {}, seenAt: Date.now() }];
  },

  async read(endpoint): Promise<Device[]> {
    // The list changes rarely, and listing takes a moment; a minute's cache keeps every poll cheap.
    const options = await memo("control:shortcuts", 60_000, listShortcuts);
    return [
      deviceOf(endpoint, {
        capabilities: [
          {
            kind: "choice",
            id: "run",
            label: "Run a shortcut",
            options,
            current: null,
            confirm: { text: "Run '{label}'? Shortcuts can do anything they are built to do, including sending messages.", action: "Run shortcut" },
          },
        ],
      }),
    ];
  },

  async act(_endpoint, _device, act: Act): Promise<void> {
    if (act.kind !== "choice") throw new HttpError(400, "unsupported", `Shortcuts cannot do "${act.capability.label}".`);
    // Check against a fresh list, not the cached one: the shortcut may have been renamed or deleted a moment ago.
    if (!(await listShortcuts()).some((s) => s.id === act.value)) throw new HttpError(404, "unknown_shortcut", "That shortcut is no longer in your Shortcuts list.");
    await run(runArgs(act.value), { timeoutMs: RUN_TIMEOUT_MS });
  },
};
