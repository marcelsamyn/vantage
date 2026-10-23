import { HttpError, ServeConfig, TAILSCALE_ENV, findTailscaleCli, json, parseBody, run, serveUse, z, type RouteHandler } from "../../server/kit";
import { ADMIN_DNS_URL, type PhoneStatus } from "./types";

const COMMAND_MS = 30_000;

const Status = z.object({
  BackendState: z.string(),
  Self: z.object({ DNSName: z.string() }).nullish(),
  CertDomains: z.array(z.string()).nullish(),
});

/** The parts of the outside world this plugin touches, so tests can stand in for the Tailscale command. */
export interface PhoneDeps {
  cli: () => Promise<string | null>;
  run: typeof run;
  port: () => number;
}

export const liveDeps: PhoneDeps = {
  cli: findTailscaleCli,
  run,
  port: () => Number(process.env["PORT"] ?? 4747),
};

function parseOutput<S extends z.ZodType>(text: string, schema: S, what: string): z.infer<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new HttpError(502, "bad_tailscale_output", `${what} did not print JSON`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(502, "bad_tailscale_output", `${what} printed a shape VANTAGE does not know: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

const NOT_RUNNING: Omit<PhoneStatus, "tailscale"> = { name: null, https: false, serving: false, otherShare: null, url: null };

export async function readStatus(deps: PhoneDeps, cli: string | null): Promise<PhoneStatus> {
  if (!cli) return { tailscale: "missing", ...NOT_RUNNING };
  let output: string;
  try {
    output = await deps.run([cli, "status", "--json"], { timeoutMs: 5000, env: TAILSCALE_ENV });
  } catch (err) {
    // The command exits non-zero while the Tailscale app is not running.
    if (err instanceof HttpError && err.code === "command_failed") return { tailscale: "stopped", ...NOT_RUNNING };
    throw err;
  }
  const status = parseOutput(output, Status, "tailscale status");
  const dns = status.Self?.DNSName.replace(/\.$/, "").toLowerCase();
  if (status.BackendState !== "Running" || !dns) return { tailscale: "stopped", ...NOT_RUNNING };

  const https = (status.CertDomains ?? []).some((d) => d.replace(/\.$/, "").toLowerCase() === dns);
  const config = parseOutput(await deps.run([cli, "serve", "status", "--json"], { timeoutMs: 5000, env: TAILSCALE_ENV }), ServeConfig, "tailscale serve status");
  // The guard applies the same rule: remote access works only while Serve shares VANTAGE alone, without Funnel.
  const use = serveUse(config, dns, deps.port());
  return { tailscale: "running", name: dns, https, serving: use.kind === "vantage", otherShare: use.kind === "other" ? use.what : null, url: `https://${dns}/` };
}

async function setShare(deps: PhoneDeps, on: boolean): Promise<PhoneStatus> {
  const cli = await deps.cli();
  const before = await readStatus(deps, cli);
  if (!cli) {
    throw new HttpError(409, "tailscale_missing", "Tailscale is not installed on this Mac. Install it from https://tailscale.com/download, then try again.");
  }
  if (before.tailscale === "stopped") {
    throw new HttpError(409, "tailscale_stopped", "Tailscale is not connected on this Mac. Open Tailscale, sign in and turn it on, then try again.");
  }
  if (on) {
    if (!before.https) {
      throw new HttpError(409, "https_off", `HTTPS certificates are off for your tailnet. Turn them on at ${ADMIN_DNS_URL}, then try again.`);
    }
    if (before.otherShare) {
      throw new HttpError(
        409,
        "name_in_use",
        `Tailscale already shows ${before.otherShare} at ${before.url}. Stop that share first with "tailscale serve --https=443 off", then try again.`,
      );
    }
    if (before.serving) return before;
    await deps.run([cli, "serve", "--bg", String(deps.port())], { timeoutMs: COMMAND_MS, env: TAILSCALE_ENV });
  } else {
    // Only stop a share that is VANTAGE: `off` clears everything on port 443, including a share the user set up elsewhere.
    if (!before.serving) return before;
    await deps.run([cli, "serve", "--https=443", "off"], { timeoutMs: COMMAND_MS, env: TAILSCALE_ENV });
  }
  return readStatus(deps, cli);
}

export function phoneRoutes(deps: PhoneDeps): Record<"GET /status" | "POST /share", RouteHandler> {
  return {
    "GET /status": async () => json(await readStatus(deps, await deps.cli())),
    "POST /share": async (req) => {
      const { on } = await parseBody(req, z.object({ on: z.boolean() }));
      return json(await setShare(deps, on));
    },
  };
}
