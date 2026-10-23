import { afterAll, beforeAll, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The store reads its folder when it loads, so point it at a temporary folder before importing it.
process.env["VANTAGE_CONTROL_DIR"] ??= mkdtempSync(join(tmpdir(), "vantage-control-"));
const { hue } = await import("./drivers/hue.server");
const { RECHECK_AFTER_MS, createFingerprintGuard, peerFingerprint } = await import("./drivers/hue-trust.server");
const { rememberEndpoints, rememberedEndpoints, savePairing, secretsOf } = await import("./store.server");
type Endpoint = Awaited<ReturnType<typeof hue.discover>>[number];

// ── Fake bridges: small servers on 127.0.0.1 that only this file starts ─────────────

interface Cert {
  key: string;
  cert: string;
  fingerprint: string;
}

async function makeCert(dir: string, name: string): Promise<Cert> {
  const proc = Bun.spawn(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.crt`), "-days", "2", "-subj", "/CN=127.0.0.1"], { stdout: "ignore", stderr: "ignore" });
  expect(await proc.exited).toBe(0);
  const cert = await Bun.file(join(dir, `${name}.crt`)).text();
  return { key: await Bun.file(join(dir, `${name}.key`)).text(), cert, fingerprint: new X509Certificate(cert).fingerprint256 };
}

interface Hit {
  method: string;
  path: string;
}
type Mode = "ok" | "redirect-302" | "redirect-307" | "unauthorized";

const CONFIG = { name: "Fake bridge", bridgeid: "FAKE", modelid: "BSB002", apiversion: "1.65.0" };
const LIGHT = { name: "Lamp", type: "Extended color light", state: { on: true, bri: 254, xy: [0.3, 0.3], reachable: true } };
const USER = "good-user";

interface Bridge {
  mode: Mode;
  /** Everything the server received. */
  hits: Hit[];
  server: ReturnType<typeof Bun.serve>;
  url: string;
  /** Every request whose path carries a username. */
  authenticated: Hit[];
}

/** An HTTPS server that behaves like a Hue bridge. `mode` changes how it answers. */
function fakeBridge(cert: Cert, victim: string): Bridge {
  const bridge: Bridge = {
    mode: "ok",
    hits: [],
    server: Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: { key: cert.key, cert: cert.cert },
      fetch(req): Response {
        const path = new URL(req.url).pathname;
        bridge.hits.push({ method: req.method, path });
        if (bridge.mode === "redirect-302" || bridge.mode === "redirect-307") {
          return new Response(null, { status: bridge.mode === "redirect-302" ? 302 : 307, headers: { location: `${victim}/api/control/devices` } });
        }
        if (path === "/api/config") return Response.json(CONFIG);
        if (path === "/api" && req.method === "POST") return Response.json([{ success: { username: USER } }]);
        if (path.startsWith(`/api/${USER}/`)) {
          if (bridge.mode === "unauthorized") return Response.json([{ error: { type: 1, description: "unauthorized user" } }]);
          if (req.method === "PUT") return Response.json([{ success: {} }]);
          if (path.endsWith("/lights")) return Response.json({ "1": LIGHT });
          return Response.json({});
        }
        return Response.json([{ error: { type: 1, description: "unauthorized user" } }]);
      },
    }),
    get url(): string {
      return `https://127.0.0.1:${bridge.server.port}`;
    },
    get authenticated(): Hit[] {
      return bridge.hits.filter((h) => h.path.startsWith("/api/") && h.path !== "/api/config" && h.path !== "/api");
    },
  };
  return bridge;
}

let certA: Cert;
let certB: Cert;
const servers: Bridge[] = [];
let victim: ReturnType<typeof Bun.serve>;
const victimHits: string[] = [];

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "vantage-hue-certs-"));
  [certA, certB] = await Promise.all([makeCert(dir, "a"), makeCert(dir, "b")]);
  // Stands in for VANTAGE's own API. A redirect that reaches it is the attack.
  victim = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      victimHits.push(`${req.method} ${new URL(req.url).pathname}`);
      return Response.json({});
    },
  });
});

afterAll(async () => {
  for (const s of servers) await s.server.stop(true);
  await victim.stop(true);
});

const start = (cert: Cert): Bridge => {
  const bridge = fakeBridge(cert, `http://127.0.0.1:${victim.port}`);
  servers.push(bridge);
  return bridge;
};

let counter = 0;
const endpointAt = (url: string, key = `hue:test-${++counter}`): Endpoint => ({ key, driver: "hue", kind: "hub", name: "Fake bridge", group: "Lights", local: false, url, meta: { ip: "127.0.0.1" }, seenAt: Date.now() });

/** An endpoint that was paired at `bridge` while it showed `cert`. */
async function paired(bridge: Bridge, cert: Cert = certA): Promise<Endpoint> {
  const endpoint = endpointAt(bridge.url);
  await rememberEndpoints([endpoint], 60_000);
  await savePairing(endpoint.key, { username: USER, address: bridge.url, fingerprint: cert.fingerprint }, bridge.url);
  return endpoint;
}

const switchOff = (endpoint: Endpoint): Promise<void> | undefined =>
  hue.act?.(
    endpoint,
    { id: `${endpoint.key}/light/1`, kind: "light", name: "Lamp", group: "", model: null, via: endpoint.key, local: false, online: true, problem: null, pairing: null, capabilities: [] },
    { kind: "switch", capability: { kind: "switch", id: "power", label: "Power", on: true }, value: false },
  );

// ── Redirects ───────────────────────────────────────────────────────

for (const mode of ["redirect-302", "redirect-307"] as const) {
  test(`a ${mode.slice(-3)} from a bridge is refused, on read, pair and act`, async () => {
    const fake = start(certA);
    fake.mode = mode;
    const unpaired = endpointAt(fake.url);
    await expect(hue.read(unpaired)).rejects.toThrow();
    await expect(hue.pair?.(unpaired)).rejects.toThrow();

    const known = await paired(fake);
    await expect(hue.read(known)).rejects.toThrow();
    await expect(switchOff(known)).rejects.toThrow();
    expect(victimHits).toEqual([]);
  });
}

// ── Pairing pins address and certificate ────────────────────────────

test("pairing stores the username with the bridge's address and certificate fingerprint", async () => {
  const fake = start(certA);
  const endpoint = endpointAt(fake.url);
  await rememberEndpoints([endpoint], 60_000);
  await hue.pair?.(endpoint);
  expect(await secretsOf(endpoint.key)).toEqual({ username: USER, address: fake.url, fingerprint: certA.fingerprint });
  expect(await peerFingerprint(fake.url)).toBe(certA.fingerprint);
});

test("a paired bridge reads and acts with the username at its paired address", async () => {
  const fake = start(certA);
  const endpoint = await paired(fake);
  const devices = await hue.read(endpoint);
  expect(devices.map((d) => d.pairing?.paired ?? "light")).toEqual([true, "light"]);
  await switchOff(endpoint);
  expect(fake.authenticated.map((h) => `${h.method} ${h.path}`)).toContain(`PUT /api/${USER}/lights/1/state`);
});

// ── The username goes nowhere else ──────────────────────────────────

test("a paired bridge that seems to have moved gets no username, and pairing again trusts the new address", async () => {
  const real = start(certA);
  const impostor = start(certB);
  const endpoint = await paired(real);

  // A scan sees the same bridge id at another address.
  await rememberEndpoints([{ ...endpoint, url: impostor.url, seenAt: Date.now() + 1 }], 60_000);
  const stored = (await rememberedEndpoints()).find((e) => e.key === endpoint.key);
  expect(stored?.url).toBe(real.url);
  expect(stored?.movedTo).toBe(impostor.url);

  const [device] = await hue.read(stored as Endpoint);
  expect(device?.pairing).toMatchObject({ paired: false, action: "Pair" });
  expect(device?.problem).toBe("Moved. Pair again to trust the new address.");
  await expect(switchOff(stored as Endpoint)).rejects.toThrow("Moved");
  expect(impostor.hits).toEqual([]);
  expect(real.authenticated).toEqual([]);

  // Even if a stale endpoint carried the new address in `url`, the username stays with the paired address.
  const swapped = { ...(stored as Endpoint), url: impostor.url };
  delete swapped.movedTo;
  await hue.read(swapped);
  await expect(switchOff(swapped)).rejects.toThrow();
  expect(impostor.authenticated).toEqual([]);

  // The user presses the link button and pairs again: that is the one way to trust the new address.
  await hue.pair?.(stored as Endpoint);
  const after = (await rememberedEndpoints()).find((e) => e.key === endpoint.key);
  expect(after?.url).toBe(impostor.url);
  expect(after?.movedTo).toBeUndefined();
  expect((await secretsOf(endpoint.key))["address"]).toBe(impostor.url);
  const [again] = await hue.read(after as Endpoint);
  expect(again?.pairing?.paired).toBe(true);
});

test("a bridge that shows another certificate gets no username", async () => {
  const impostor = start(certB);
  // Paired while the bridge showed certificate A; the server at this address now shows B.
  const endpoint = await paired(impostor, certA);
  const [device] = await hue.read(endpoint);
  expect(device?.pairing?.paired).toBe(false);
  expect(device?.problem).toContain("different certificate");
  await expect(switchOff(endpoint)).rejects.toThrow("different certificate");
  expect(impostor.hits).toEqual([]);
  expect((await secretsOf(endpoint.key))["username"]).toBe(USER);
});

test("a pairing from before addresses were pinned must be made again, and is not deleted", async () => {
  const fake = start(certA);
  const endpoint = endpointAt(fake.url);
  await rememberEndpoints([endpoint], 60_000);
  await savePairing(endpoint.key, { username: USER }, fake.url);
  const [device] = await hue.read(endpoint);
  expect(device?.pairing?.paired).toBe(false);
  expect(fake.hits).toEqual([]);
  expect((await secretsOf(endpoint.key))["username"]).toBe(USER);
});

// ── A refusal never deletes a pairing ───────────────────────────────

test("error type 1 from the bridge does not delete the pairing", async () => {
  const fake = start(certA);
  const endpoint = await paired(fake);
  fake.mode = "unauthorized";
  const [device] = await hue.read(endpoint);
  expect(device?.pairing?.paired).toBe(false);
  expect(device?.problem).toContain("Pair again");
  expect(await secretsOf(endpoint.key)).toEqual({ username: USER, address: fake.url, fingerprint: certA.fingerprint });

  // The bridge accepts the username again, so the pairing was never lost.
  fake.mode = "ok";
  const [recovered] = await hue.read(endpoint);
  expect(recovered?.pairing?.paired).toBe(true);
});

// ── Fingerprint checks are rare ─────────────────────────────────────

test("the certificate is checked at most once every 10 minutes per bridge, and a mismatch is refused", async () => {
  let clock = 1_000_000;
  const asked: string[] = [];
  let shown = "AA:BB";
  const guard = createFingerprintGuard(async (address: string) => {
    asked.push(address);
    return shown;
  }, () => clock);

  expect(await guard.matches("hue:x", "https://10.0.0.2", "AA:BB")).toBe(true);
  clock += RECHECK_AFTER_MS - 1;
  shown = "CC:DD";
  expect(await guard.matches("hue:x", "https://10.0.0.2", "AA:BB")).toBe(true);
  expect(asked).toHaveLength(1);

  clock += 1;
  expect(await guard.matches("hue:x", "https://10.0.0.2", "AA:BB")).toBe(false);
  expect(asked).toHaveLength(2);
});

test("a failed certificate check is asked again on the next call", async () => {
  let attempts = 0;
  const guard = createFingerprintGuard(async () => {
    if (++attempts === 1) throw new Error("unreachable");
    return "AA";
  });
  await expect(guard.matches("hue:y", "https://10.0.0.3", "AA")).rejects.toThrow("unreachable");
  expect(await guard.matches("hue:y", "https://10.0.0.3", "AA")).toBe(true);
});
