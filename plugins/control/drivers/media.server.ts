import { HttpError } from "../../../server/kit";
import { appleScript, deviceOf, type Act, type Driver, type Endpoint } from "../driver.server";
import { allow, isAllowed } from "../store.server";
import type { Capability, Device, MediaState, Track } from "../types";

/**
 * Now playing and transport for Music and Spotify, through AppleScript.
 * Discovery checks which players are running without sending them Apple events, so it never launches an app and
 * never triggers a permission prompt. Reading what plays does send Apple events, which macOS guards with a one-time
 * Automation prompt per app; VANTAGE sends none until the user selects Allow.
 */

interface Player {
  id: string;
  name: string;
  bundle: string;
  /** Spotify reports track length in milliseconds, Music in seconds. */
  durationDivisor: number;
  /** Spotify offers a cover URL; Music only offers raw image data. */
  artwork: boolean;
}

export const PLAYERS: readonly Player[] = [
  { id: "music", name: "Music", bundle: "com.apple.Music", durationDivisor: 1, artwork: false },
  { id: "spotify", name: "Spotify", bundle: "com.spotify.client", durationDivisor: 1000, artwork: true },
];

/** JavaScript for Automation: asking `running()` sends no Apple event, and a missing app is simply "false". */
export const RUNNING_SCRIPT = [`${JSON.stringify(PLAYERS.map((p) => p.bundle))}.map((id) => { try { return Application(id).running() } catch (e) { return false } }).join(",")`];

/**
 * The script re-checks that the app runs, because `tell` would launch a player that quit since discovery.
 * Bundle ids are constants from PLAYERS; nothing from the browser is ever spliced into script source.
 */
export function readScript(p: Player): string[] {
  // Optional fields sit in `try` blocks: a live stream has no duration, and an ad or podcast may lack the rest.
  const optional = (name: string, expression: string): string[] => [`set ${name} to ""`, "try", `set ${name} to (${expression}) as text`, "end try"];
  return [
    `if application id "${p.bundle}" is not running then return "closed"`,
    `tell application id "${p.bundle}"`,
    "set s to player state as text",
    'if s is "stopped" then return "stopped"',
    "try",
    "set t to current track",
    "on error",
    'return "stopped"',
    "end try",
    ...optional("n", "name of t"),
    ...optional("ar", "artist of t"),
    ...optional("al", "album of t"),
    ...optional("d", `(duration of t) / ${p.durationDivisor}`),
    ...optional("pos", "player position"),
    ...optional("art", p.artwork ? "artwork url of t" : '""'),
    "return s & linefeed & n & linefeed & ar & linefeed & al & linefeed & d & linefeed & pos & linefeed & art",
    "end tell",
  ];
}

export function commandScript(p: Player): string[] {
  return [
    "on run argv",
    `if application id "${p.bundle}" is not running then return`,
    `tell application id "${p.bundle}"`,
    'if (item 1 of argv) is "playpause" then playpause',
    'if (item 1 of argv) is "pause" then pause',
    'if (item 1 of argv) is "next" then next track',
    'if (item 1 of argv) is "previous" then previous track',
    "end tell",
    "end run",
  ];
}

/** AppleScript prints numbers with the user's decimal separator and "missing value" for unknowns. */
const number = (text: string | undefined): number | null => {
  const n = Number((text ?? "").replace(",", "."));
  return text && Number.isFinite(n) ? n : null;
};
const textOrNull = (text: string | undefined): string | null => (text && text !== "missing value" ? text : null);

export function parseNowPlaying(output: string): { state: MediaState; track: Track | null } | "closed" {
  const [state = "", title, artist, album, duration, position, artwork] = output.split("\n");
  if (state === "closed") return "closed";
  if (state === "stopped") return { state: "stopped", track: null };
  return {
    state: state === "playing" ? "playing" : "paused",
    track: {
      title: textOrNull(title) ?? "Unknown track",
      artist: textOrNull(artist),
      album: textOrNull(album),
      duration: number(duration),
      position: number(position),
      artwork: textOrNull(artwork)?.startsWith("https://") ? (artwork ?? null) : null,
    },
  };
}

const playerOf = (endpoint: Endpoint): Player => {
  const player = PLAYERS.find((p) => p.id === endpoint.meta["player"]);
  if (!player) throw new HttpError(500, "unknown_player", `No media player is registered for ${endpoint.name}.`);
  return player;
};

async function nowPlaying(p: Player, timeoutMs?: number): Promise<{ state: MediaState; track: Track | null }> {
  const result = parseNowPlaying(await appleScript(readScript(p), [], { timeoutMs }));
  if (result === "closed") throw new HttpError(410, "closed", `${p.name} has quit.`);
  return result;
}

export const media: Driver = {
  id: "media",

  async discover(): Promise<Endpoint[]> {
    const running = (await appleScript(RUNNING_SCRIPT, [], { language: "JavaScript" })).split(",");
    return PLAYERS.filter((_, i) => running[i] === "true").map((p) => ({
      key: `media:${p.id}`,
      driver: "media",
      kind: "player",
      name: p.name,
      group: "On this Mac",
      local: true,
      url: null,
      meta: { player: p.id },
      seenAt: Date.now(),
    }));
  },

  async read(endpoint): Promise<Device[]> {
    const p = playerOf(endpoint);
    const pairing = {
      prompt: `To show what ${p.name} is playing and to pause or skip, VANTAGE needs to control ${p.name}. macOS will ask you once; choose OK.`,
      action: "Allow",
    };
    if (!(await isAllowed(p.id))) return [deviceOf(endpoint, { pairing: { ...pairing, paired: false }, capabilities: [] })];

    const { state, track } = await nowPlaying(p);
    const capability: Capability = {
      kind: "media",
      id: "player",
      label: "Now playing",
      state,
      track,
      ...(state === "playing" ? { blackout: `Pause ${p.name}` } : {}),
    };
    return [deviceOf(endpoint, { pairing: { ...pairing, paired: true }, capabilities: [capability] })];
  },

  async act(endpoint, _device, act: Act): Promise<void> {
    if (act.kind !== "media") throw new HttpError(400, "unsupported", `${endpoint.name} cannot do "${act.capability.label}".`);
    await appleScript(commandScript(playerOf(endpoint)), [act.value]);
  },

  async pair(endpoint): Promise<void> {
    const p = playerOf(endpoint);
    // The first Apple event shows the macOS prompt; wait while the user answers it.
    await nowPlaying(p, 60_000);
    await allow(p.id);
  },
};
