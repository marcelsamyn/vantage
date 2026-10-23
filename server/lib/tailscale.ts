import { z } from "zod";

/** The standalone app ships its CLI inside the bundle; Homebrew and the open-source build put `tailscale` on PATH. */
const APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

/** Path of the `tailscale` command, or null when Tailscale is not installed. */
export async function findTailscaleCli(): Promise<string | null> {
  return Bun.which("tailscale") ?? ((await Bun.file(APP_CLI).exists()) ? APP_CLI : null);
}

/**
 * The app binary decides from its environment whether it was started as the CLI or as the app. Without a terminal,
 * as under a server, it tries to open the app and fails ("The Tailscale GUI failed to start"); this variable says CLI.
 */
export const TAILSCALE_ENV: Record<string, string> = { TAILSCALE_BE_CLI: "1" };

/** The parts of `tailscale serve status --json` that say what this Mac shares, and whether Funnel publishes it. */
export const ServeConfig = z.object({
  Web: z.record(z.string(), z.object({ Handlers: z.record(z.string(), z.object({ Proxy: z.string().optional() })).nullish() })).nullish(),
  AllowFunnel: z.record(z.string(), z.boolean()).nullish(),
});
export type ServeConfig = z.infer<typeof ServeConfig>;

/** Whether a serve target is this server: `http://127.0.0.1:<port>` or localhost, with or without a trailing slash. */
export function isThisServer(proxy: string, port: number): boolean {
  if (!URL.canParse(proxy)) return false;
  const url = new URL(proxy);
  return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) && url.port === String(port) && url.pathname === "/";
}

export type ServeUse = { kind: "none" } | { kind: "vantage" } | { kind: "other"; what: string };

/**
 * How Serve uses https://<host>/. VANTAGE may answer remotely only when it is the one thing shared there, at "/",
 * without Funnel: anything else on the same origin could run script as VANTAGE, and Funnel opens it to the internet.
 */
export function serveUse(config: ServeConfig, host: string, port: number): ServeUse {
  const key = `${host}:443`;
  const site = Object.entries(config.Web ?? {}).find(([name]) => name.toLowerCase() === key)?.[1];
  const handlers = Object.entries(site?.Handlers ?? {});
  if (handlers.length === 0) return { kind: "none" };
  if (Object.entries(config.AllowFunnel ?? {}).some(([name, on]) => on && name.toLowerCase() === key)) {
    return { kind: "other", what: "Tailscale Funnel, which publishes it to the internet" };
  }
  const foreign = handlers.find(([path, h]) => !(path === "/" && h.Proxy !== undefined && isThisServer(h.Proxy, port)));
  if (!foreign) return { kind: "vantage" };
  const [path, handler] = foreign;
  const target = handler.Proxy ?? "a folder or text";
  return { kind: "other", what: path === "/" ? target : `${target} at ${path}` };
}
