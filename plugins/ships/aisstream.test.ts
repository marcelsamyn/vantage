import { afterEach, expect, test } from "bun:test";
import source, { parseAisStream } from "./api";
import { shipSourceProblem } from "./vessel";
import { GlobalAisStream, subscriptionBoxes } from "./aisstream";

const box = { west: -81, south: 25, east: -79, north: 27 };
const metadata = { MMSI: 368207620, ShipName: "EXAMPLE VESSEL   ", latitude: 25.7617, longitude: -80.1918, time_utc: "2026-10-11 10:00:00.000000 +0000 UTC" };
const position = { UserID: metadata.MMSI, Valid: true, Latitude: metadata.latitude, Longitude: metadata.longitude, Sog: 12.4, Cog: 86.7, TrueHeading: 87, NavigationalStatus: 0 };
const envelope = (type: string, message: unknown): unknown => ({ MessageType: type, MetaData: metadata, Message: { [type]: message } });

test("AIS Stream decodes positions and unavailable AIS values", () => {
  expect(parseAisStream(envelope("PositionReport", position))).toMatchObject({ kind: "position", position: { mmsi: 368207620, lat: 25.7617, lon: -80.1918, sogKt: 12.4 }, name: "EXAMPLE VESSEL", at: Date.UTC(2026, 9, 11, 10) });
  expect(parseAisStream(envelope("PositionReport", { ...position, Sog: 102.3, Cog: 360, TrueHeading: 511, NavigationalStatus: 15 }))).toMatchObject({ position: { sogKt: null, cogDeg: null, headingDeg: null, navStatus: null } });
  expect(parseAisStream(envelope("PositionReport", { ...position, Longitude: 181 }))).toBeNull();
  expect(parseAisStream(envelope("PositionReport", { ...position, Valid: false }))).toBeNull();
  expect(() => parseAisStream(envelope("PositionReport", { ...position, Sog: "12" }))).toThrow();
});

test("AIS Stream decodes static/voyage, class B parts, safety text and SAR aircraft", () => {
  expect(parseAisStream(envelope("ShipStaticData", { UserID: metadata.MMSI, Valid: true, Name: "EXAMPLE", CallSign: "WXYZ", ImoNumber: 1234567, Type: 70, Dimension: { A: 90, B: 10, C: 5, D: 5 }, Eta: { Month: 10, Day: 12, Hour: 8, Minute: 30 }, MaximumStaticDraught: 6.4, Destination: "MIAMI" }))).toMatchObject({ kind: "static", info: { name: "EXAMPLE", callSign: "WXYZ", imo: 1234567, shipType: 70, draughtM: 6.4, destination: "MIAMI", eta: [10, 12, 8, 30] } });
  expect(parseAisStream(envelope("StaticDataReport", { UserID: metadata.MMSI, Valid: true, PartNumber: false, ReportA: { Valid: true, Name: "CLASS B" }, ReportB: { Valid: false, ShipType: 0, CallSign: "", Dimension: { A: 0, B: 0, C: 0, D: 0 } } }))).toMatchObject({ kind: "static", info: { name: "CLASS B" } });
  expect(parseAisStream(envelope("AddressedSafetyMessage", { UserID: metadata.MMSI, Valid: true, Text: "KEEP CLEAR", DestinationID: 123456789 }))).toMatchObject({ kind: "safety", report: { text: "KEEP CLEAR", recipientMmsi: 123456789 } });
  expect(parseAisStream(envelope("StandardSearchAndRescueAircraftReport", { ...position, Altitude: 300 }))).toMatchObject({ kind: "position", reportKind: "sar-aircraft", altitudeM: 300 });
  expect(parseAisStream({ MessageType: "SubscriptionConfirmation", Message: { CompressionEnabled: true } })).toEqual({ kind: "confirmed", compressed: true });
});

test("subscriptions split boxes at the date line", () => {
  expect(subscriptionBoxes([{ west: 170, south: -10, east: -170, north: 10 }])).toEqual([[[ -10, 170 ], [10, 180]], [[-10, -180], [10, -170]]]);
});

const cleanup: (() => void)[] = [];
afterEach(() => { while (cleanup.length) cleanup.pop()?.(); });
const until = async (done: () => boolean, ms = 2500): Promise<void> => { const end = Date.now() + ms; while (!done() && Date.now() < end) await Bun.sleep(10); if (!done()) throw new Error("condition not met"); };

function feed(reject = false, messages?: unknown[], silent = false): { url: string; subscriptions: unknown[]; opens: () => number; closes: () => number } {
  let opened = 0;
  let closed = 0;
  const subscriptions: unknown[] = [];
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req, server) { if (server.upgrade(req)) return; return new Response("upgrade required", { status: 400 }); }, websocket: {
    perMessageDeflate: true,
    open() { opened++; },
    message(ws, message) {
      subscriptions.push(JSON.parse(String(message)));
      if (reject) { ws.send(JSON.stringify({ error: "invalid test-secret key" })); return; }
      if (silent) return;
      if (messages) { for (const message of messages) ws.send(Buffer.from(JSON.stringify(message)), true); return; }
      ws.send(Buffer.from(JSON.stringify({ MessageType: "SubscriptionConfirmation", Message: { CompressionEnabled: true } })), true);
      ws.send(Buffer.from(JSON.stringify(envelope("ShipStaticData", { UserID: metadata.MMSI, Valid: true, Name: "EXAMPLE", CallSign: "WXYZ", ImoNumber: 1234567, Type: 70, Dimension: { A: 90, B: 10, C: 5, D: 5 }, Eta: { Month: 10, Day: 12, Hour: 8, Minute: 30 }, MaximumStaticDraught: 6.4, Destination: "MIAMI" }))), true);
      ws.send(Buffer.from(JSON.stringify({ MessageType: "PositionReport", MetaData: { ...metadata, time_utc: new Date().toISOString() }, Message: { PositionReport: position } })), true);
    }, close() { closed++; },
  } });
  cleanup.push(() => server.stop(true));
  return { url: `ws://127.0.0.1:${server.port}`, subscriptions, opens: () => opened, closes: () => closed };
}

test("global stream opens on demand, consumes binary JSON, keeps enrichment and closes at idle", async () => {
  const source = feed();
  const stream = new GlobalAisStream({ key: "test-secret", parse: parseAisStream, connect: () => new WebSocket(source.url), idleCloseMs: 120, tickMs: 10 });
  cleanup.push(() => stream.dispose());
  expect(source.opens()).toBe(0);
  stream.want(box);
  await until(() => stream.within(box).length === 1);
  expect(stream.state).toBe("connected");
  expect(stream.find(metadata.MMSI)?.info).toMatchObject({ name: "EXAMPLE", destination: "MIAMI", draughtM: 6.4 });
  expect(source.subscriptions[0]).toMatchObject({ APIKey: "test-secret", BoundingBoxes: [[[25, -81], [27, -79]]] });
  await until(() => stream.state === "idle");
  await until(() => source.closes() === 1);
  stream.want(box);
  await until(() => source.opens() === 2);
});

test("global stream rate limits replacements and retains each active requested area", async () => {
  const source = feed();
  const stream = new GlobalAisStream({ key: "test-secret", parse: parseAisStream, connect: () => new WebSocket(source.url), tickMs: 10, idleCloseMs: 5000 });
  cleanup.push(() => stream.dispose());
  stream.want(box);
  await until(() => source.subscriptions.length === 1);
  stream.want({ west: 1, south: 40, east: 3, north: 42 });
  stream.want({ west: 4, south: 40, east: 6, north: 42 });
  await Bun.sleep(100);
  expect(source.subscriptions).toHaveLength(1);
  await until(() => source.subscriptions.length === 2);
  expect(source.subscriptions[1]).toMatchObject({ BoundingBoxes: [[[25, -81], [27, -79]], [[40, 1], [42, 3]], [[40, 4], [42, 6]]] });
  stream.want(box);
  await Bun.sleep(1200);
  expect(source.subscriptions).toHaveLength(2);
});

test("global stream redacts source errors, backs off, and stops retrying at idle", async () => {
  const source = feed(true);
  const stream = new GlobalAisStream({ key: "test-secret", parse: parseAisStream, connect: () => new WebSocket(source.url), retryMs: 40, idleCloseMs: 180, tickMs: 10 });
  cleanup.push(() => stream.dispose());
  stream.want(box);
  await until(() => stream.state === "unreachable");
  expect(stream.error).not.toContain("test-secret");
  await until(() => source.opens() >= 2);
  await until(() => stream.state === "idle");
  const opened = source.opens();
  await Bun.sleep(100);
  expect(source.opens()).toBe(opened);
});


test("global stream bounds static-only records and expires cached positions", async () => {
  const report = (mmsi: number, name: string): unknown => ({ MessageType: "StaticDataReport", MetaData: { ...metadata, MMSI: mmsi }, Message: { StaticDataReport: { UserID: mmsi, Valid: true, PartNumber: false, ReportA: { Valid: true, Name: name }, ReportB: { Valid: false, ShipType: 0, CallSign: "", Dimension: { A: 0, B: 0, C: 0, D: 0 } } } } });
  const source = feed(false, [report(metadata.MMSI, "EVICTED"), report(123456789, "TWO"), report(123456788, "THREE"), { MessageType: "PositionReport", MetaData: { ...metadata, time_utc: new Date().toISOString() }, Message: { PositionReport: position } }]);
  const stream = new GlobalAisStream({ key: "test-secret", parse: parseAisStream, connect: () => new WebSocket(source.url), maxRecords: 2, staleMs: 100, tickMs: 10 });
  cleanup.push(() => stream.dispose());
  stream.want(box);
  await until(() => stream.find(metadata.MMSI) !== null);
  expect(stream.find(metadata.MMSI)?.info.name).toBe("EXAMPLE VESSEL");
  await until(() => stream.find(metadata.MMSI) === null);
});

test("global stream times out an unconfirmed subscription and retries", async () => {
  const source = feed(false, undefined, true);
  const stream = new GlobalAisStream({ key: "test-secret", parse: parseAisStream, connect: () => new WebSocket(source.url), connectTimeoutMs: 50, retryMs: 50, idleCloseMs: 5000, tickMs: 10 });
  cleanup.push(() => stream.dispose());
  stream.want(box);
  await until(() => stream.state === "unreachable");
  expect(stream.error).toContain("did not confirm");
  await until(() => source.opens() >= 2);
});

test("global stream merges class B parts and keeps safety text beside the vessel", async () => {
  const partA = { UserID: metadata.MMSI, Valid: true, PartNumber: false, ReportA: { Valid: true, Name: "CLASS B" }, ReportB: { Valid: false, ShipType: 0, CallSign: "", Dimension: { A: 0, B: 0, C: 0, D: 0 } } };
  const source = feed(false, [envelope("StaticDataReport", partA), envelope("StaticDataReport", { ...partA, PartNumber: true, ReportB: { Valid: true, ShipType: 37, CallSign: "WXYZ", Dimension: { A: 3, B: 2, C: 1, D: 1 } } }), { MessageType: "SafetyBroadcastMessage", MetaData: { ...metadata, time_utc: new Date().toISOString() }, Message: { SafetyBroadcastMessage: { UserID: metadata.MMSI, Valid: true, Text: "KEEP CLEAR" } } }, { MessageType: "PositionReport", MetaData: { ...metadata, time_utc: new Date().toISOString() }, Message: { PositionReport: position } }]);
  const stream = new GlobalAisStream({ key: "test-secret", parse: parseAisStream, connect: () => new WebSocket(source.url) });
  cleanup.push(() => stream.dispose());
  stream.want(box);
  await until(() => stream.find(metadata.MMSI) !== null);
  expect(stream.find(metadata.MMSI)?.info).toMatchObject({ name: "CLASS B", shipType: 37, callSign: "WXYZ", toBowM: 3 });
  expect(stream.find(metadata.MMSI)?.safetyReports[0]?.text).toBe("KEEP CLEAR");
});

test("missing global key explains setup without making a network request outside Nordic waters", async () => {
  if (process.env.VANTAGE_AISSTREAM_KEY) return;
  const route = source.routes["GET /near"];
  if (!route) throw new Error("missing ships route");
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: route });
  cleanup.push(() => server.stop(true));
  const response = await fetch(`http://127.0.0.1:${server.port}/?west=-81&south=25&east=-79&north=27`);
  expect(response.status).toBe(200);
  const payload: unknown = await response.json();
  expect(payload).toMatchObject({ vessels: [], sources: [ { id: "aisstream", state: "unconfigured", error: expect.stringContaining("VANTAGE_AISSTREAM_KEY") }, { id: "digitraffic", state: "idle" }, { id: "kystverket", state: "idle" } ] });
  expect(shipSourceProblem({ fetchedAt: 0, vessels: [], sources: [{ id: "aisstream", name: "AIS Stream", state: "unconfigured", count: 0, error: "Set VANTAGE_AISSTREAM_KEY" }] })).toContain("VANTAGE_AISSTREAM_KEY");
});
