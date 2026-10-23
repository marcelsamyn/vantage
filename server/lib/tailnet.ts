import { z } from "zod";
import { run } from "./exec";
import { log } from "./log";
import { ServeConfig, TAILSCALE_ENV, findTailscaleCli, serveUse } from "./tailscale";

/**
 * Remote use through Tailscale Serve. `tailscale serve` proxies https://<this-mac>.<tailnet>.ts.net to this server
 * on 127.0.0.1 and adds the caller's Tailscale identity as `Tailscale-User-*` headers, replacing any the caller
 * sent. The guard accepts that host only for a login in `logins`: the account that owns this Mac's node, plus any
 * listed in VANTAGE_TAILSCALE_LOGINS.
 */
export interface Tailnet {
  /** This Mac's MagicDNS name, lower case, without the trailing dot. */
  host: string;
  /** Lower-case Tailscale logins that may use VANTAGE remotely. */
  logins: ReadonlySet<string>;
}

const Status = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string(), UserID: z.number() }).nullish(),
  User: z.record(z.string(), z.object({ LoginName: z.string() })).nullish(),
});

/** Who may use VANTAGE remotely, from `tailscale status --json`. Null while Tailscale is not running. */
export function tailnetFrom(raw: unknown, extraLogins: readonly string[] = []): Tailnet | null {
  const parsed = Status.safeParse(raw);
  if (!parsed.success || parsed.data.BackendState !== "Running" || !parsed.data.Self) return null;
  const { Self, User } = parsed.data;
  const host = Self.DNSName.replace(/\.$/, "").toLowerCase();
  const owner = User?.[String(Self.UserID)]?.LoginName;
  const logins = new Set([owner, ...extraLogins].filter((l): l is string => Boolean(l)).map((l) => l.toLowerCase()));
  return host && logins.size ? { host, logins } : null;
}

/** Run one Tailscale command and parse its JSON, or log why not and return null. */
async function readJson(cli: string, args: string[]): Promise<unknown> {
  const output = await run([cli, ...args], { timeoutMs: 5000, env: TAILSCALE_ENV }).catch((err: unknown) => {
    log.warn("tailscale command failed", { args: args.join(" "), error: err instanceof Error ? err.message : String(err) });
    return null;
  });
  if (output === null) return null;
  try {
    return JSON.parse(output);
  } catch {
    // The CLI prints prose instead of JSON when it cannot reach the Tailscale daemon; show it, it says why.
    log.warn("tailscale printed no JSON", { args: args.join(" "), output: output.slice(0, 300) });
    return null;
  }
}

/**
 * Read who may use VANTAGE remotely, from the live Tailscale state. Null unless Serve shares VANTAGE alone at
 * this Mac's name (see `serveUse`), so another share on the same origin or Funnel turns remote access off.
 */
export function readTailnet(port: number, extraLogins: readonly string[]): () => Promise<Tailnet | null> {
  return async () => {
    const cli = await findTailscaleCli();
    if (!cli) return null;
    const net = tailnetFrom(await readJson(cli, ["status", "--json"]), extraLogins);
    if (!net) return null;
    const config = ServeConfig.safeParse(await readJson(cli, ["serve", "status", "--json"]));
    const use = config.success ? serveUse(config.data, net.host, port) : null;
    if (use?.kind === "vantage") return net;
    log.warn("remote access is off: Tailscale Serve does not share VANTAGE alone", { host: net.host, shares: use?.kind === "other" ? use.what : (use?.kind ?? "unknown") });
    return null;
  };
}

const FRESH_MS = 60_000;

/**
 * Read the tailnet only when a request arrives for a host other than localhost, at most once a minute, and once for
 * many such requests at a time, so VANTAGE spends nothing on Tailscale while nobody uses it remotely, and starting
 * Tailscale or changing what it shares needs no restart.
 */
export function tailnetAccess(read: () => Promise<Tailnet | null>): () => Promise<Tailnet | null> {
  let known: { at: number; value: Tailnet | null } | null = null;
  let reading: Promise<Tailnet | null> | null = null;
  return () => {
    if (known && Date.now() - known.at < FRESH_MS) return Promise.resolve(known.value);
    reading ??= read()
      .then((value) => {
        known = { at: Date.now(), value };
        return value;
      })
      .finally(() => {
        reading = null;
      });
    return reading;
  };
}

/** Logins listed in VANTAGE_TAILSCALE_LOGINS (comma-separated), for other accounts of your own. */
export function extraLoginsFromEnv(): string[] {
  return (process.env["VANTAGE_TAILSCALE_LOGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
