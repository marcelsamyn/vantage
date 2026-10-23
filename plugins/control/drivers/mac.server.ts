import { HttpError, memo, run } from "../../../server/kit";
import { appleScript, deviceOf, type Act, type Driver, type Endpoint } from "../driver.server";
import { allow, isAllowed } from "../store.server";
import type { Capability, Device } from "../types";

/**
 * This Mac: output volume and mute, keep awake, sleep the display, light or dark appearance, and speech.
 * Everything runs through macOS's own command-line tools with fixed argument lists.
 */

const KEY = "mac";
export const SPEAK_MAX = 500;

// ── Keep awake ────────────────────────────────────────────────────

/**
 * `caffeinate -di` holds the display and the system awake while it runs. `-w <pid>` ends it when this server exits,
 * even after a crash. Its state is read from the process table rather than kept in memory, so it stays true across
 * a development restart that keeps the server's process id.
 */
export const caffeinateArgs = (): [string, ...string[]] => ["caffeinate", "-di", "-w", String(process.pid)];

async function awakePids(): Promise<string[]> {
  const wanted = caffeinateArgs().join(" ");
  const out = await run(["ps", "-axo", "pid=,command="]);
  return out
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null && m[2]?.trim() === wanted)
    .map((m) => m[1] ?? "");
}

export interface AwakeControl {
  pids(): Promise<string[]>;
  start(): void;
  stop(pids: string[]): Promise<void>;
}

/**
 * Switches run one after another. Two requests that read the process table at the same moment would both see no
 * `caffeinate` and start two of them, and turning off would then miss the second.
 */
export function createAwakeSetter(control: AwakeControl): (on: boolean) => Promise<void> {
  let chain: Promise<unknown> = Promise.resolve();
  return (on) => {
    const task = chain.then(async () => {
      const pids = await control.pids();
      if (on && pids.length === 0) control.start();
      if (!on && pids.length > 0) await control.stop(pids);
    });
    chain = task.catch(() => undefined);
    return task;
  };
}

const setAwake = createAwakeSetter({
  pids: awakePids,
  // A long-lived child that the kit's `run` and `lines` cannot hand back for stopping later, so it is spawned here.
  // The argument list is fixed and no shell is involved.
  start: () => void Bun.spawn(caffeinateArgs(), { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref(),
  stop: async (pids) => void (await run(["kill", ...pids])),
});

// ── Volume, appearance, identity ──────────────────────────────────

export interface VolumeSettings {
  /** 0–100, or null when the output device sets its own volume (HDMI, some USB interfaces). */
  volume: number | null;
  muted: boolean;
}

/** Parse "output volume:50, input volume:27, alert volume:100, output muted:false". */
export function parseVolume(text: string): VolumeSettings {
  const volume = /output volume:(\d+)/.exec(text)?.[1];
  return { volume: volume === undefined ? null : Number(volume), muted: /output muted:true/.test(text) };
}

/** Reads the setting without System Events, so reading never triggers an Automation prompt. */
const READ_APPEARANCE = ['ObjC.import("Foundation"); $.NSUserDefaults.standardUserDefaults.stringForKey("AppleInterfaceStyle").isNil() ? "light" : "dark"'];

export const SCRIPTS = {
  setVolume: ["on run argv", "set volume output volume (item 1 of argv as integer)", "end run"],
  setMuted: ["on run argv", 'set volume output muted ((item 1 of argv) is "true")', "end run"],
  setAppearance: ["on run argv", 'tell application "System Events" to tell appearance preferences to set dark mode to ((item 1 of argv) is "dark")', "end run"],
  speak: ["on run argv", "say (item 1 of argv)", "end run"],
} as const;

const identity = (): Promise<{ name: string; model: string; os: string }> =>
  memo("control:mac:identity", 60 * 60_000, async () => {
    const [name, model, os] = await Promise.all([run(["scutil", "--get", "ComputerName"]), run(["sysctl", "-n", "hw.model"]), run(["sw_vers", "-productVersion"])]);
    return { name: name.trim(), model: model.trim(), os: os.trim() };
  });

// ── Driver ────────────────────────────────────────────────────────

export const mac: Driver = {
  id: "mac",

  async discover(): Promise<Endpoint[]> {
    return [{ key: KEY, driver: "mac", kind: "computer", name: "This Mac", group: "This Mac", local: true, url: null, meta: {}, seenAt: Date.now() }];
  },

  async read(endpoint): Promise<Device[]> {
    const [who, sound, appearance, awake, automationAllowed] = await Promise.all([
      identity(),
      appleScript(["get volume settings"]).then(parseVolume),
      appleScript(READ_APPEARANCE, [], { language: "JavaScript" }),
      awakePids(),
      isAllowed("system-events"),
    ]);

    const capabilities: Capability[] = [];
    if (sound.volume !== null) {
      capabilities.push({ kind: "level", id: "volume", label: "Volume", value: sound.volume }, { kind: "switch", id: "mute", label: "Mute", on: sound.muted });
    }
    capabilities.push(
      { kind: "switch", id: "awake", label: "Keep awake", on: awake.length > 0 },
      { kind: "action", id: "sleep-display", label: "Sleep display", blackout: "Sleep the display" },
      {
        kind: "choice",
        id: "appearance",
        label: "Appearance",
        options: [
          { id: "light", label: "Light" },
          { id: "dark", label: "Dark" },
        ],
        current: appearance,
        ...(automationAllowed ? {} : { confirm: { text: "Switch to {label} mode? The first time, macOS asks whether VANTAGE may control System Events. Choose OK, or the switch cannot happen.", action: "Switch to {label}" } }),
      },
      { kind: "action", id: "say", label: "Speak", input: { placeholder: "Text to say aloud", maxLength: SPEAK_MAX } },
    );
    // Some outputs (HDMI, many USB interfaces) set their own volume, so macOS reports none.
    if (sound.volume === null) capabilities.push({ kind: "info", id: "sound", label: "Sound", rows: [["Volume", "Set on the output device"]] });
    return [deviceOf(endpoint, { name: who.name, model: `${who.model} · macOS ${who.os}`, capabilities })];
  },

  async act(_endpoint, _device, act: Act): Promise<void> {
    const id = act.capability.id;
    switch (act.kind) {
      case "level":
        if (id === "volume") return void (await appleScript(SCRIPTS.setVolume, [String(act.value)]));
        break;
      case "switch":
        if (id === "mute") return void (await appleScript(SCRIPTS.setMuted, [String(act.value)]));
        if (id === "awake") return setAwake(act.value);
        break;
      case "action":
        if (id === "sleep-display") return void (await run(["pmset", "displaysleepnow"]));
        if (id === "say" && act.value !== null) return void (await appleScript(SCRIPTS.speak, [act.value], { timeoutMs: 90_000 }));
        break;
      case "choice":
        if (id === "appearance") {
          // Long timeout: the first switch waits while the user answers the macOS Automation prompt.
          await appleScript(SCRIPTS.setAppearance, [act.value], { timeoutMs: 60_000 });
          return allow("system-events");
        }
        break;
      default:
        break;
    }
    throw new HttpError(400, "unsupported", `This Mac cannot do "${act.capability.label}".`);
  },
};
