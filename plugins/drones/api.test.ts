import { afterEach, expect, setSystemTime, test } from "bun:test";
import type { Server } from "bun";
import source, { loadDrones, receiverUrl } from "./api";
import { hasRecentPosition, operatorLabel, receiverProblem, recentDrones } from "./view";

const servers: Server<undefined>[] = [];
afterEach(() => { setSystemTime(); for (const server of servers.splice(0)) server.stop(true); });

function receiver(answer: () => Response | Promise<Response>): string {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: answer });
  servers.push(server);
  return `http://127.0.0.1:${server.port}/data/remoteid.json`;
}

function feed(drones: unknown[], now = Date.now() / 1000): Response {
  return Response.json({ schema_version: 1, now, messages: 4213, drones });
}

function closedPort(): string {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const url = `http://127.0.0.1:${server.port}/data/remoteid.json`;
  server.stop(true);
  return url;
}

test("receiver URLs come only from server configuration and must be plain HTTP feed URLs", () => {
  expect(receiverUrl(undefined)).toBeNull();
  expect(receiverUrl("")).toBeNull();
  for (const url of ["pi:8754", "file:///etc/passwd", "http://user:password@pi/feed", "http://pi/feed?token=secret", "http://pi/feed#x"]) {
    expect(() => receiverUrl(url)).toThrow();
  }
  expect(receiverUrl("http://pi:8754/data/remoteid.json")?.href).toBe("http://pi:8754/data/remoteid.json");
});

test("without configuration VANTAGE reads the default receiver and shows setup when none answers", async () => {
  const present = await loadDrones("", receiver(() => feed([{ id: "default-receiver", id_type: "serial", seen: 0 }])));
  expect(present).toMatchObject({ state: "ready", drones: [{ id: "default-receiver" }] });
  expect(await loadDrones("", closedPort())).toMatchObject({ state: "setup", receiverAt: null, drones: [] });
  await expect(loadDrones(closedPort())).rejects.toThrow("unreachable");
});

test("an absent default receiver is looked for again only after 30 seconds", async () => {
  const url = closedPort();
  expect((await loadDrones("", url)).state).toBe("setup");
  let requests = 0;
  const { port } = new URL(url);
  servers.push(Bun.serve({ hostname: "127.0.0.1", port: Number(port), fetch: () => { requests++; return feed([]); } }));
  expect((await loadDrones("", url)).state).toBe("setup");
  expect(requests).toBe(0);
  setSystemTime(Date.now() + 30_001);
  expect((await loadDrones("", url)).state).toBe("ready");
  expect(requests).toBe(1);
});

test("a default receiver whose lookup never answers counts as absent", async () => {
  const url = receiver(() => new Promise<Response>(() => undefined));
  expect((await loadDrones("", url)).state).toBe("setup");
}, 10_000);

test("a default receiver that answers badly is reported, not mistaken for an absent one", async () => {
  const url = receiver(() => Response.json({ error: "clock_not_set" }, { status: 503 }));
  await expect(loadDrones("", url)).rejects.toThrow("HTTP 503");
});

test("the route ignores a browser-supplied receiver URL", async () => {
  const previous = process.env.VANTAGE_DRONE_RECEIVER_URL;
  process.env.VANTAGE_DRONE_RECEIVER_URL = receiver(() => feed([{ id: "configured", id_type: "serial", seen: 0 }]));
  const handler = source.routes["GET /"];
  if (!handler) throw new Error("Drone route is missing");
  const app = Bun.serve({ hostname: "127.0.0.1", port: 0, routes: { "/api/drones": { GET: handler } } });
  servers.push(app);
  try {
    const response = await fetch(`http://127.0.0.1:${app.port}/api/drones?url=http://unwanted.invalid/feed`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ state: "ready", drones: [{ id: "configured" }] });
  } finally {
    if (previous === undefined) delete process.env.VANTAGE_DRONE_RECEIVER_URL;
    else process.env.VANTAGE_DRONE_RECEIVER_URL = previous;
  }
});

test("a real HTTP receiver preserves ID-only reports and converts broadcast units once", async () => {
  const snapshot = await loadDrones(receiver(() => feed([
    { id: "OP-SESSION-77F2", id_type: "session", seen: 1.1, message_count: 4 },
    { id: "1581F5EXAMPLE0001", id_type: "serial", ua_type: "helicopter", lat: 40.7128, lon: -74.006,
      alt_geom_ft: 412, agl_ft: 380, gs: 12.3, track: 271, geom_rate: -64, rssi: -62, seen: 0.4,
      seen_pos: 0.6, rid_source: "wifi_beacon", rid_sources: ["wifi_beacon", "ble5"], message_count: 137,
      self_id: "inspection <script>", self_id_seen: 1.8, operator: { lat: 40.69, lon: -74.01, id: "FA3OPERATOR123", location_type: "takeoff", alt_takeoff_ft: 50, seen: 2.3 } },
    { id: "550e8400-e29b-41d4-a716-446655440000", id_type: "utm_uuid", seen: 1 },
  ])));
  expect(snapshot.state).toBe("ready");
  const [identity, drone] = snapshot.drones;
  if (!identity || !drone) throw new Error("Expected both reports");
  expect(identity.position).toBeNull();
  expect(hasRecentPosition(identity, snapshot.fetchedAt)).toBe(false);
  expect(drone.altitudeM).toBeCloseTo(125.5776);
  expect(drone.heightM).toBeCloseTo(115.824);
  expect(drone.speedKt).toBe(12.3);
  expect(drone.verticalSpeedMps).toBeCloseTo(-0.32512);
  expect(drone.operator).toMatchObject({ locationType: "takeoff", position: { lat: 40.69, lon: -74.01 }, id: "FA3OPERATOR123", takeoffAltitudeM: 15.24 });
  expect(drone.transports).toEqual(["wifi_beacon", "ble5"]);
  expect(drone.description).toBe("inspection <script>");
  expect(operatorLabel(drone.operator?.locationType ?? null)).toBe("Launch point");
  expect(operatorLabel("live_gnss")).toBe("Operator GNSS position");
  expect(operatorLabel("fixed")).toBe("Fixed operator position");
  expect(hasRecentPosition(drone, snapshot.fetchedAt)).toBe(true);
  expect(recentDrones(snapshot, snapshot.fetchedAt)).toHaveLength(3);
  expect(snapshot.drones[2]?.idType).toBe("utm_uuid");
});

test("fresh identity does not refresh an old or undated GPS fix", async () => {
  const snapshot = await loadDrones(receiver(() => feed([
    { id: "old-fix", id_type: "serial", lat: 41.9, lon: 12.5, seen: 0, seen_pos: 61 },
    { id: "undated-fix", id_type: "unknown", lat: 41.9, lon: 12.5, seen: 0 },
    { id: "expired-id", id_type: "session", lat: 41.9, lon: 12.5, seen: 61, seen_pos: 0 },
  ])));
  expect(recentDrones(snapshot, snapshot.fetchedAt).map((d) => d.id)).toEqual(["old-fix", "undated-fix"]);
  for (const drone of snapshot.drones) expect(hasRecentPosition(drone, snapshot.fetchedAt)).toBe(false);
  expect(recentDrones(snapshot, snapshot.fetchedAt + 61_000)).toEqual([]);
});

test("an old receiver snapshot and retained client data cannot claim current detections", async () => {
  const snapshot = await loadDrones(receiver(() => feed([{ id: "frozen", id_type: "unknown", seen: 0 }], Date.now() / 1000 - 120)));
  expect(receiverProblem(snapshot, snapshot.fetchedAt)).toContain("snapshot is old");
  expect(recentDrones(snapshot, snapshot.fetchedAt)).toEqual([]);
  const fresh = await loadDrones(receiver(() => feed([{ id: "fresh", id_type: "serial", seen: 0 }])));
  expect(receiverProblem(fresh, fresh.fetchedAt)).toBeNull();
  expect(receiverProblem(fresh, fresh.fetchedAt + 10_001)).toContain("snapshot is old");
  expect(recentDrones(fresh, fresh.fetchedAt + 10_001)).toEqual([]);
});

test("unknown schema versions and malformed coordinate pairs fail at the feed boundary", async () => {
  for (const answer of [
    () => Response.json({ schema_version: 2, now: Date.now() / 1000, messages: 0, drones: [] }),
    () => feed([{ id: "bad", id_type: "serial", lat: 41.9, seen: 0 }]),
    () => feed([{ id: "bad", id_type: "serial", seen: -1 }]),
    () => feed([{ id: "bad", id_type: "serial", seen: 0, operator: { lon: 12 } }]),
  ]) await expect(loadDrones(receiver(answer))).rejects.toThrow("unexpected data");
});

test("receiver redirects are refused and a different configured URL has its own cache", async () => {
  let followed = 0;
  const destination = receiver(() => { followed++; return feed([]); });
  const redirected = receiver(() => Response.redirect(destination));
  await expect(loadDrones(redirected)).rejects.toThrow("unreachable");
  expect(followed).toBe(0);
  let requests = 0;
  const first = receiver(() => { requests++; return feed([{ id: "receiver-a", id_type: "unknown", seen: 0 }]); });
  const second = receiver(() => feed([{ id: "receiver-b", id_type: "unknown", seen: 0 }]));
  expect((await loadDrones(first)).drones[0]?.id).toBe("receiver-a");
  expect((await loadDrones(first)).drones[0]?.id).toBe("receiver-a");
  expect(requests).toBe(1);
  expect((await loadDrones(second)).drones[0]?.id).toBe("receiver-b");
});

test("a failed refresh does not serve an old live snapshot past the two-second cache window", async () => {
  let offline = false;
  const url = receiver(() => offline ? new Response("Receiver denied access", { status: 403 }) : feed([{ id: "gone", id_type: "serial", seen: 0 }]));
  expect((await loadDrones(url)).drones[0]?.id).toBe("gone");
  offline = true;
  await Bun.sleep(2050);
  await expect(loadDrones(url)).rejects.toThrow("HTTP 403");
});
