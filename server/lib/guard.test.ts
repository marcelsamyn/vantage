import { describe, expect, test } from "bun:test";
import type { BunRequest } from "bun";
import { json } from "./http";
import { makeGuard } from "./router";
import { tailnetFrom, type Tailnet } from "./tailnet";

const PORT = 4747;
const NET: Tailnet = { host: "mac.example-tailnet.ts.net", logins: new Set(["owner@example.org"]) };
const ok = makeGuard(PORT, async () => NET)(async () => json({ ok: true }));
const offline = makeGuard(PORT)(async () => json({ ok: true }));

async function send(guarded: typeof ok, headers: Record<string, string>, method = "GET"): Promise<{ status: number; code: string | null }> {
  const res = await guarded(new Request(`http://${headers["host"] ?? "127.0.0.1:4747"}/api/core/health`, { method, headers }) as BunRequest<string>);
  const body = (await res.json()) as { error?: { code: string } };
  return { status: res.status, code: body.error?.code ?? null };
}

const owner = { host: NET.host, "tailscale-user-login": "Owner@Example.org", "sec-fetch-site": "same-origin" };

describe("the request guard", () => {
  test("answers on localhost, as before", async () => {
    expect(await send(ok, { host: "127.0.0.1:4747" })).toEqual({ status: 200, code: null });
    expect(await send(offline, { host: "localhost:4747" })).toEqual({ status: 200, code: null });
  });

  test("refuses a DNS-rebinding host, with or without Tailscale", async () => {
    expect((await send(ok, { host: "evil.example:4747" })).code).toBe("bad_host");
    expect((await send(offline, { host: NET.host, "tailscale-user-login": "owner@example.org" })).code).toBe("bad_host");
  });

  test("answers this Mac's Tailscale name for its owner, from the same origin, including changes", async () => {
    expect(await send(ok, owner)).toEqual({ status: 200, code: null });
    expect(await send(ok, { ...owner, host: `${NET.host}:443` })).toEqual({ status: 200, code: null });
    expect(await send(ok, { ...owner, origin: `https://${NET.host}`, "x-vantage": "1", "content-type": "application/json" }, "POST")).toEqual({ status: 200, code: null });
  });

  test("refuses the Tailscale name without the owner's login, for another login, and for Funnel requests", async () => {
    const { "tailscale-user-login": _, ...anonymous } = owner;
    expect(await send(ok, anonymous)).toEqual({ status: 403, code: "tailnet_user" });
    expect(await send(ok, { ...owner, "tailscale-user-login": "guest@example.org" })).toEqual({ status: 403, code: "tailnet_user" });
    expect(await send(ok, { ...owner, "tailscale-funnel-request": "?1" })).toEqual({ status: 403, code: "funnel" });
  });

  test("a proxied request is remote even when its Host says localhost", async () => {
    // As if a proxy rewrote Host: without the owner's login it must not pass as local.
    expect((await send(ok, { host: "127.0.0.1:4747", "x-forwarded-for": "100.64.0.9" })).code).toBe("bad_host");
    expect((await send(ok, { host: "127.0.0.1:4747", "x-forwarded-host": NET.host, "x-forwarded-for": "100.64.0.9" })).code).toBe("tailnet_user");
    expect(await send(ok, { host: "127.0.0.1:4747", "x-forwarded-host": NET.host, "tailscale-user-login": "owner@example.org" })).toEqual({ status: 200, code: null });
    expect((await send(offline, { host: "127.0.0.1:4747", "x-forwarded-proto": "https" })).code).toBe("bad_host");
  });

  test("Funnel is refused on every host, localhost included", async () => {
    expect(await send(ok, { host: "127.0.0.1:4747", "tailscale-funnel-request": "?1" })).toEqual({ status: 403, code: "funnel" });
  });

  test("the Tailscale name only bare or on 443: no trailing dot, other port or short name", async () => {
    for (const host of [`${NET.host}.`, `${NET.host}:8443`, "mac", "100.64.0.1"]) expect((await send(ok, { ...owner, host })).code).toBe("bad_host");
  });

  test("over Tailscale, only the Tailscale origin counts as this app", async () => {
    expect((await send(ok, { ...owner, origin: "http://127.0.0.1:4747" })).code).toBe("cross_site");
    expect((await send(ok, { ...owner, "sec-fetch-site": "cross-site" })).code).toBe("cross_site");
    expect((await send(ok, { host: "127.0.0.1:4747", origin: `https://${NET.host}` })).code).toBe("cross_site");
  });
});

/** Shaped like `tailscale status --json` on a Mac (fields VANTAGE does not read are left out). */
const status = (over: Record<string, unknown> = {}): unknown => ({
  BackendState: "Running",
  Self: { DNSName: "Mac.Example-Tailnet.ts.net.", UserID: 1234, Online: true },
  User: { "1234": { ID: 1234, LoginName: "Owner@Example.org", DisplayName: "Owner" }, "99": { ID: 99, LoginName: "shared@example.org" } },
  ...over,
});

describe("reading the tailnet", () => {
  test("takes this Mac's name without the trailing dot and its owner's login, in lower case", () => {
    const net = tailnetFrom(status());
    expect(net?.host).toBe("mac.example-tailnet.ts.net");
    expect([...(net?.logins ?? [])]).toEqual(["owner@example.org"]);
  });

  test("adds logins from VANTAGE_TAILSCALE_LOGINS, never other users of the tailnet", () => {
    expect([...(tailnetFrom(status(), ["Me@Work.example"])?.logins ?? [])]).toEqual(["owner@example.org", "me@work.example"]);
  });

  test("is null while Tailscale is stopped, logged out or answers something else", () => {
    expect(tailnetFrom(status({ BackendState: "Stopped" }))).toBeNull();
    expect(tailnetFrom(status({ Self: null }))).toBeNull();
    expect(tailnetFrom("not json")).toBeNull();
  });
});

describe("the hosted request guard", () => {
  const origin = "https://vantage.example.com:8443";
  const hosted = makeGuard(PORT, async () => { throw new Error("Hosted requests must not inspect Tailscale"); }, origin)(async () => json({ ok: true }));
  const headers = { host: "vantage.example.com:8443", origin, "sec-fetch-site": "same-origin" };

  test("accepts direct and reverse-proxied requests at the configured origin", async () => {
    expect((await send(hosted, headers)).status).toBe(200);
    expect((await send(hosted, { ...headers, "x-forwarded-for": "203.0.113.7", "x-forwarded-proto": "https" })).status).toBe(200);
    expect((await send(hosted, { ...headers, host: "vantage:4747", "x-forwarded-host": headers.host })).status).toBe(200);
  });

  test("retains cross-site and mutation checks behind a proxy", async () => {
    expect((await send(hosted, { ...headers, origin: "https://foreign.example" })).code).toBe("cross_site");
    expect((await send(hosted, { ...headers, "sec-fetch-site": "cross-site" })).code).toBe("cross_site");
    expect((await send(hosted, headers, "POST")).code).toBe("client_header");
    expect((await send(hosted, { ...headers, "x-vantage": "1", "content-type": "application/json" }, "POST")).status).toBe(200);
    expect((await send(hosted, { ...headers, "tailscale-funnel-request": "?1" })).code).toBe("funnel");
  });

  test("does not grant access to another host or port", async () => {
    const guarded = makeGuard(PORT, undefined, origin)(async () => json({ ok: true }));
    for (const host of ["foreign.example", "vantage.example.com", "vantage.example.com:9999"]) {
      expect((await send(guarded, { ...headers, host })).code).toBe("bad_host");
    }
  });
});
