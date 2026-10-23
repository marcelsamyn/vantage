import { describe, expect, test } from "bun:test";
import type { BunRequest } from "bun";
import { HttpError } from "../../server/kit";
import { phoneRoutes, readStatus, type PhoneDeps } from "./phone.server";
import { ADMIN_DNS_URL, type PhoneStatus } from "./types";

const CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
const NAME = "my-mac.example-tailnet.ts.net";

/** Shaped like `tailscale status --json`, trimmed to the keys the plugin reads plus a few it ignores. */
function statusJson(over: { BackendState?: string; CertDomains?: string[] | null; Self?: object | null } = {}): string {
  return JSON.stringify({
    Version: "1.98.5",
    BackendState: "Running",
    Self: { ID: "n1", HostName: "My-Mac", DNSName: `${NAME}.`, UserID: 1, Online: true },
    CertDomains: [NAME],
    User: { "1": { LoginName: "owner@example.com" } },
    ...over,
  });
}

/** Shaped like `tailscale serve status --json`. */
function serveJson(proxy: string, host = `${NAME}:443`, path = "/"): string {
  return JSON.stringify({ TCP: { "443": { HTTPS: true } }, Web: { [host]: { Handlers: { [path]: { Proxy: proxy } } } } });
}

interface Stub {
  deps: PhoneDeps;
  /** Every command the plugin ran, as one string each. */
  ran: string[];
  /** The `TAILSCALE_BE_CLI` value each command ran with. */
  cliMode: (string | undefined)[];
}

/** Stands in for the Tailscale command. `serve --bg` and `serve --https=443 off` change what `serve status` prints next. */
function stub(opts: { cli?: string | null; status?: string | Error; serve?: string; port?: number }): Stub {
  let serve = opts.serve ?? "{}";
  const ran: string[] = [];
  const cliMode: (string | undefined)[] = [];
  const deps: PhoneDeps = {
    cli: async () => (opts.cli === undefined ? CLI : opts.cli),
    port: () => opts.port ?? 4747,
    run: async (cmd, options) => {
      ran.push(cmd.join(" "));
      cliMode.push(options?.env?.["TAILSCALE_BE_CLI"]);
      const args = cmd.slice(1).join(" ");
      if (args === "status --json") {
        if (opts.status instanceof Error) throw opts.status;
        return opts.status ?? statusJson();
      }
      if (args === "serve status --json") return serve;
      if (args === `serve --bg ${opts.port ?? 4747}`) serve = serveJson(`http://127.0.0.1:${opts.port ?? 4747}`);
      else if (args === "serve --https=443 off") serve = "{}";
      else throw new Error(`unexpected command: ${cmd.join(" ")}`);
      return "";
    },
  };
  return { deps, ran, cliMode };
}

async function post(deps: PhoneDeps, body: unknown): Promise<Response> {
  const req = new Request("http://127.0.0.1/api/phone/share", {
    method: "POST",
    headers: { "content-type": "application/json", "x-vantage": "1" },
    body: JSON.stringify(body),
  });
  return phoneRoutes(deps)["POST /share"](req as BunRequest<string>);
}

async function refusal(deps: PhoneDeps, body: unknown): Promise<HttpError> {
  const err = await post(deps, body).then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof HttpError)) throw new Error("the route should refuse with an HttpError");
  return err;
}

const base = { name: null, https: false, serving: false, otherShare: null, url: null } satisfies Omit<PhoneStatus, "tailscale">;

describe("readStatus", () => {
  test("missing: no Tailscale command", async () => {
    const { deps, ran } = stub({ cli: null });
    expect(await readStatus(deps, await deps.cli())).toEqual({ tailscale: "missing", ...base });
    expect(ran).toEqual([]);
  });

  test("stopped: the command fails because the app is not running", async () => {
    const { deps } = stub({ status: new HttpError(500, "command_failed", "tailscale exited with code 1: failed to connect to local Tailscale service") });
    expect(await readStatus(deps, CLI)).toEqual({ tailscale: "stopped", ...base });
  });

  test("stopped: signed out or switched off", async () => {
    for (const state of ["Stopped", "NeedsLogin"]) {
      const { deps, ran } = stub({ status: statusJson({ BackendState: state, Self: null, CertDomains: null }) });
      expect(await readStatus(deps, CLI)).toEqual({ tailscale: "stopped", ...base });
      expect(ran).toEqual([`${CLI} status --json`]);
    }
  });

  test("running without HTTPS certificates", async () => {
    const { deps } = stub({ status: statusJson({ CertDomains: null }) });
    expect(await readStatus(deps, CLI)).toEqual({ tailscale: "running", name: NAME, https: false, serving: false, otherShare: null, url: `https://${NAME}/` });
  });

  test("running with HTTPS certificates for another name only", async () => {
    const { deps } = stub({ status: statusJson({ CertDomains: ["other.example-tailnet.ts.net"] }) });
    expect((await readStatus(deps, CLI)).https).toBe(false);
  });

  test("running with HTTPS and nothing served", async () => {
    const { deps } = stub({});
    expect(await readStatus(deps, CLI)).toEqual({ tailscale: "running", name: NAME, https: true, serving: false, otherShare: null, url: `https://${NAME}/` });
  });

  test("serving another port is not serving VANTAGE", async () => {
    const { deps } = stub({ serve: serveJson("http://127.0.0.1:3000") });
    expect(await readStatus(deps, CLI)).toMatchObject({ serving: false, otherShare: "http://127.0.0.1:3000" });
  });

  test("serving a different port than the server's PORT is not serving VANTAGE", async () => {
    const { deps } = stub({ serve: serveJson("http://127.0.0.1:4747"), port: 4888 });
    expect(await readStatus(deps, CLI)).toMatchObject({ serving: false, otherShare: "http://127.0.0.1:4747" });
  });

  test("serving VANTAGE", async () => {
    const { deps } = stub({ serve: serveJson("http://127.0.0.1:4747") });
    expect(await readStatus(deps, CLI)).toEqual({ tailscale: "running", name: NAME, https: true, serving: true, otherShare: null, url: `https://${NAME}/` });
  });

  test("serving VANTAGE on the port the server uses, whatever the case of the host", async () => {
    const { deps } = stub({ serve: serveJson("http://localhost:4888/", `${NAME.toUpperCase()}:443`), port: 4888 });
    expect(await readStatus(deps, CLI)).toMatchObject({ serving: true, otherShare: null });
  });

  test("a share on another path only counts as another share", async () => {
    const { deps } = stub({ serve: serveJson("http://127.0.0.1:4747", `${NAME}:443`, "/vantage") });
    expect(await readStatus(deps, CLI)).toMatchObject({ serving: false, otherShare: "http://127.0.0.1:4747 at /vantage" });
  });

  test("a share on another host name leaves this name free", async () => {
    const { deps } = stub({ serve: serveJson("http://127.0.0.1:3000", "other.example-tailnet.ts.net:443") });
    expect(await readStatus(deps, CLI)).toMatchObject({ serving: false, otherShare: null });
  });

  test("output that is not JSON becomes a 502", async () => {
    const { deps } = stub({ status: "Tailscale is stopped." });
    await expect(readStatus(deps, CLI)).rejects.toMatchObject({ status: 502, code: "bad_tailscale_output" });
  });
});

test("every Tailscale command runs in CLI mode, so the app's binary does not start its GUI", async () => {
  const on = stub({});
  await post(on.deps, { on: true });
  const off = stub({ serve: serveJson("http://127.0.0.1:4747") });
  await post(off.deps, { on: false });
  const modes = [...on.cliMode, ...off.cliMode];
  expect(modes.length).toBeGreaterThanOrEqual(8);
  expect(modes.every((m) => m === "1")).toBe(true);
});

describe("POST /share", () => {
  test("refuses to turn sharing on while HTTPS certificates are off, and runs nothing", async () => {
    const { deps, ran } = stub({ status: statusJson({ CertDomains: null }) });
    const err = await refusal(deps, { on: true });
    expect(err.status).toBe(409);
    expect(err.code).toBe("https_off");
    expect(err.message).toContain(ADMIN_DNS_URL);
    expect(ran).not.toContain(`${CLI} serve --bg 4747`);
    expect(ran.every((c) => c.endsWith("--json"))).toBe(true);
  });

  test("refuses while Tailscale is missing or stopped", async () => {
    expect((await refusal(stub({ cli: null }).deps, { on: true })).code).toBe("tailscale_missing");
    const stopped = stub({ status: statusJson({ BackendState: "Stopped", Self: null }) });
    expect((await refusal(stopped.deps, { on: false })).code).toBe("tailscale_stopped");
    expect(stopped.ran).toEqual([`${CLI} status --json`]);
  });

  test("refuses to replace a share it did not make", async () => {
    const { deps, ran } = stub({ serve: serveJson("http://127.0.0.1:3000") });
    const err = await refusal(deps, { on: true });
    expect(err.code).toBe("name_in_use");
    expect(err.message).toContain("http://127.0.0.1:3000");
    expect(ran.some((c) => c.includes("--bg"))).toBe(false);
  });

  test("turns sharing on with `serve --bg <PORT>` and returns the new status", async () => {
    const { deps, ran } = stub({});
    const body = (await (await post(deps, { on: true })).json()) as PhoneStatus;
    expect(ran.filter((c) => c.includes("serve") && !c.endsWith("--json"))).toEqual([`${CLI} serve --bg 4747`]);
    expect(body).toMatchObject({ tailscale: "running", serving: true, url: `https://${NAME}/` });
  });

  test("uses the server's PORT", async () => {
    const { deps, ran } = stub({ port: 4888 });
    await post(deps, { on: true });
    expect(ran).toContain(`${CLI} serve --bg 4888`);
  });

  test("turns sharing off with `serve --https=443 off` and returns the new status", async () => {
    const { deps, ran } = stub({ serve: serveJson("http://127.0.0.1:4747") });
    const body = (await (await post(deps, { on: false })).json()) as PhoneStatus;
    expect(ran.filter((c) => c.includes("serve") && !c.endsWith("--json"))).toEqual([`${CLI} serve --https=443 off`]);
    expect(body.serving).toBe(false);
  });

  test("changes nothing when the share is already in the asked state", async () => {
    const on = stub({ serve: serveJson("http://127.0.0.1:4747") });
    expect(((await (await post(on.deps, { on: true })).json()) as PhoneStatus).serving).toBe(true);
    const off = stub({});
    expect(((await (await post(off.deps, { on: false })).json()) as PhoneStatus).serving).toBe(false);
    expect([...on.ran, ...off.ran].every((c) => c.endsWith("--json"))).toBe(true);
  });

  test("does not stop a share that is not VANTAGE", async () => {
    const { deps, ran } = stub({ serve: serveJson("http://127.0.0.1:3000") });
    await post(deps, { on: false });
    expect(ran.some((c) => c.endsWith(" off"))).toBe(false);
  });

  test("rejects a body without a boolean `on`", async () => {
    const { deps, ran } = stub({});
    expect((await refusal(deps, { on: "yes" })).status).toBe(400);
    expect(ran).toEqual([]);
  });
});
