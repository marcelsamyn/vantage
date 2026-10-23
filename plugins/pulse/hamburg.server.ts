import mqtt, { type MqttClient } from "mqtt";
import { HttpError, fetchJson, log, memo, z } from "../../server/kit";
import { distanceM } from "../../shared/geo";
import { Watchdog } from "./watchdog";
import type { LaneKind, SignalDetail, SignalHead, SignalHeads, SignalStream, SignalStreamEvent } from "./types";

/**
 * Hamburg publishes the live phase of its traffic lights as OGC SensorThings (FROST):
 * a REST API at /v1.1 and MQTT at mqtt://tld.iot.hamburg.de:1883, the two interfaces its service root documents.
 * The REST API finds the signal heads in view; MQTT delivers each change as it happens.
 * Data licence: Datenlizenz Deutschland Namensnennung 2.0, source "Freie und Hansestadt Hamburg, zuständige Behörde".
 */

const SOURCE = "Hamburg traffic lights";
const REST = "https://tld.iot.hamburg.de/v1.1";
const BROKER = "mqtt://tld.iot.hamburg.de:1883";

/** Heads on screen at once. More would be unreadable and costs the city's server more than a personal dashboard should. */
export const MAX_HEADS = 250;
/** A head whose newest observation is older than this has been switched off or abandoned. */
const LIVE_WINDOW_MS = 24 * 3_600_000;
const POLL_MS = 2_000;
/** MQTT silence beyond this, with heads subscribed, triggers a REST check. */
const MQTT_SILENCE_MS = 30_000;
const IDLE_CLOSE_MS = 60_000;
const QUIET_CHECK_MS = 15_000;
const MAX_POLL_BACKOFF_MS = 60_000;
/** A REST fallback poll never asks for more than this much history. */
const MAX_POLL_WINDOW_MS = 120_000;
const SNAPSHOT_CHUNK = 100;

// ── REST ──────────────────────────────────────────────────────────

/** The area a datastream observes: usually a point or a short line at the stop line, now and then a polygon. */
const Area = z.object({ type: z.string(), coordinates: z.unknown() });
const MultiLine = z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]).rest(z.number()))) });

const HeadRow = z.object({
  "@iot.id": z.number(),
  observedArea: Area.nullish(),
  resultTime: z.string().nullish(),
  properties: z.object({ signalGroupID: z.string().nullish() }).nullish(),
  Thing: z.object({
    "@iot.id": z.number(),
    name: z.string(),
    properties: z.object({ laneType: z.string().nullish(), trafficLightsID: z.union([z.string(), z.number()]).nullish() }).nullish(),
    Locations: z.array(z.object({ location: z.object({ geometry: z.object({ type: z.string(), coordinates: z.unknown() }) }).nullish() })).optional(),
  }),
});
const HeadPage = z.object({ value: z.array(HeadRow) });

function rest(path: string, params: Record<string, string>): URL {
  const url = new URL(`${REST}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

function laneKind(laneType: string | null | undefined): LaneKind {
  const t = laneType ?? "";
  if (/KFZ/.test(t)) return "vehicle";
  if (/Bus/.test(t)) return "bus";
  if (/Fußgänger/.test(t)) return "pedestrian";
  if (/Radfahrer/.test(t)) return "cycle";
  return "vehicle";
}

/** The end of an SensorThings time interval ("start/end"), or the instant itself. */
function intervalEnd(value: string | null | undefined): number {
  if (!value) return 0;
  const end = value.includes("/") ? (value.split("/")[1] ?? "") : value;
  const t = Date.parse(end);
  return Number.isFinite(t) ? t : 0;
}

const r6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The middle vertex of any GeoJSON coordinates: the stop line's position. */
function middleOf(area: z.infer<typeof Area> | null | undefined): [number, number] | null {
  if (!area) return null;
  const flat: [number, number][] = [];
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === "number" && typeof c[1] === "number") flat.push([c[0], c[1]]);
    else for (const inner of c) walk(inner);
  };
  walk(area.coordinates);
  return flat[Math.floor(flat.length / 2)] ?? null;
}

function headOf(row: z.infer<typeof HeadRow>, withRoute: boolean): SignalHead | null {
  const mid = middleOf(row.observedArea);
  if (!mid) return null;
  const geometry = row.Thing.Locations?.[0]?.location?.geometry;
  // A lane connection is three lines: the lane in, the path through the junction, the lane out. Only the path is drawn.
  const lines = withRoute && geometry?.type === "MultiLineString" ? MultiLine.safeParse(geometry) : null;
  const path = lines?.success ? lines.data.coordinates[1] : undefined;
  const junction = String(row.Thing.properties?.trafficLightsID ?? row.Thing.name.split("_")[0] ?? "");
  return {
    id: row["@iot.id"],
    thing: row.Thing["@iot.id"],
    name: row.Thing.name,
    junction,
    group: row.properties?.signalGroupID ?? null,
    lane: laneKind(row.Thing.properties?.laneType),
    lat: r6(mid[1]),
    lon: r6(mid[0]),
    route: path && path.length > 1 ? path.map((p): [number, number] => [r6(p[0]), r6(p[1])]) : null,
  };
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Quantize so that panning a little reuses the cached list; the polygon grows by one step. */
function snap(b: Bounds, step: number): Bounds {
  return { west: Math.floor(b.west / step) * step, south: Math.floor(b.south / step) * step, east: Math.ceil(b.east / step) * step, north: Math.ceil(b.north / step) * step };
}

async function listHeads(b: Bounds, withRoute: boolean): Promise<SignalHead[]> {
  const poly = `POLYGON((${b.west} ${b.south},${b.east} ${b.south},${b.east} ${b.north},${b.west} ${b.north},${b.west} ${b.south}))`;
  const expand = withRoute ? "Thing($select=@iot.id,name,properties/laneType,properties/trafficLightsID;$expand=Locations($select=location))" : "Thing($select=@iot.id,name,properties/laneType,properties/trafficLightsID)";
  const page = await fetchJson(
    SOURCE,
    rest("Datastreams", {
      $filter: `properties/layerName eq 'primary_signal' and st_intersects(Thing/Locations/location,geography'${poly}')`,
      $select: "@iot.id,observedArea,resultTime,properties/signalGroupID",
      $expand: expand,
      $top: "3000",
    }),
    HeadPage,
    { timeoutMs: 25_000 },
  );
  const cutoff = Date.now() - LIVE_WINDOW_MS;
  const heads: SignalHead[] = [];
  for (const row of page.value) {
    if (intervalEnd(row.resultTime) < cutoff) continue;
    const head = headOf(row, withRoute);
    if (head) heads.push(head);
  }
  return heads;
}

/** Signal heads inside the bounds that report live, the `MAX_HEADS` nearest to the centre when there are more. */
export async function signalHeads(view: Bounds, routes: boolean): Promise<SignalHeads> {
  const b = snap(view, 0.004);
  const key = `pulse:heads:${b.west}:${b.south}:${b.east}:${b.north}:${routes ? "r" : "p"}`;
  const all = await memo(key, 60_000, () => listHeads(b, routes), 3_600_000);
  const inView = all.filter((h) => h.lon >= view.west && h.lon <= view.east && h.lat >= view.south && h.lat <= view.north);
  if (inView.length <= MAX_HEADS) return { heads: inView, total: inView.length, capped: false };
  const centre = { lat: (view.south + view.north) / 2, lon: (view.west + view.east) / 2 };
  const nearest = inView
    .map((h) => ({ h, d: distanceM(centre, h) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, MAX_HEADS)
    .map((x) => x.h);
  return { heads: nearest, total: inView.length, capped: true };
}

// ── Detail for one lane connection ────────────────────────────────

const DetailRow = z.object({
  "@iot.id": z.number(),
  name: z.string(),
  observedArea: Area.nullish(),
  properties: z.object({ layerName: z.string() }),
  Observations: z.array(z.object({ phenomenonTime: z.string(), result: z.union([z.number(), z.boolean()]) })).default([]),
});
const ThingRow = z.object({
  "@iot.id": z.number(),
  name: z.string(),
  properties: z.object({ laneType: z.string().nullish(), trafficLightsID: z.union([z.string(), z.number()]).nullish(), ingressLaneID: z.union([z.string(), z.number()]).nullish(), egressLaneID: z.union([z.string(), z.number()]).nullish() }).nullish(),
  Datastreams: z.array(DetailRow),
});
const HistoryPage = z.object({ value: z.array(z.object({ phenomenonTime: z.string(), result: z.number() })) });

const STREAM_KINDS: Record<string, SignalStream["kind"]> = {
  primary_signal: "primary",
  secondary_signal: "secondary",
  acoustic_signal: "acoustic",
  detector_car: "car",
  detector_cyclists: "cycle",
  detector_pedestrian: "pedestrian",
  detector_acoustic_traffic_request: "acoustic-request",
  "bus_pre-request_point": "bus-pre",
  bus_request_point: "bus-request",
  bus_checkout: "bus-checkout",
  signal_program: "program",
};

const HISTORY_WINDOW_MS = 150_000;

export async function signalDetail(thing: number): Promise<SignalDetail> {
  return memo(`pulse:thing:${thing}`, 20_000, async () => {
    const row = await fetchJson(
      SOURCE,
      rest(`Things(${thing})`, {
        $select: "@iot.id,name,properties",
        $expand: "Datastreams($select=@iot.id,name,observedArea,properties/layerName;$expand=Observations($top=1;$orderby=phenomenonTime desc;$select=phenomenonTime,result))",
      }),
      ThingRow,
    );
    const streams: SignalStream[] = [];
    let primary: (typeof row.Datastreams)[number] | undefined;
    for (const ds of row.Datastreams) {
      const kind = STREAM_KINDS[ds.properties.layerName];
      if (!kind) continue;
      if (kind === "primary") primary = ds;
      const obs = ds.Observations[0];
      streams.push({ id: ds["@iot.id"], name: ds.name, layer: ds.properties.layerName, kind, value: obs?.result ?? null, at: obs ? Date.parse(obs.phenomenonTime) : null });
    }
    if (!primary) throw new HttpError(404, "no_signal", `Lane connection ${row.name} has no primary signal head`);
    const mid = middleOf(primary.observedArea);
    if (!mid) throw new HttpError(404, "no_position", `Lane connection ${row.name} has no position`);

    const recent = await fetchJson(
      SOURCE,
      rest(`Datastreams(${primary["@iot.id"]})/Observations`, { $orderby: "phenomenonTime desc", $top: "40", $select: "phenomenonTime,result" }),
      HistoryPage,
    );
    const cutoff = Date.now() - HISTORY_WINDOW_MS;
    const inWindow = recent.value.filter((o) => Date.parse(o.phenomenonTime) >= cutoff);
    // One older observation tells which state the window opens in.
    const before = recent.value[inWindow.length];
    const history = [...(before ? [before] : []), ...[...inWindow].reverse()].map((o) => ({ v: o.result, at: Date.parse(o.phenomenonTime) }));
    // The stream shows the same event twice when two controllers report; keep real changes only.
    const changes = history.filter((h, i) => i === 0 || h.v !== history[i - 1]?.v);

    return {
      thing: row["@iot.id"],
      name: row.name,
      junction: String(row.properties?.trafficLightsID ?? row.name.split("_")[0] ?? ""),
      laneType: row.properties?.laneType ?? "",
      ingressLane: row.properties?.ingressLaneID === undefined || row.properties.ingressLaneID === null ? null : String(row.properties.ingressLaneID),
      egressLane: row.properties?.egressLaneID === undefined || row.properties.egressLaneID === null ? null : String(row.properties.egressLaneID),
      primary: primary["@iot.id"],
      group: null,
      lat: r6(mid[1]),
      lon: r6(mid[0]),
      streams,
      history: changes,
    } satisfies SignalDetail;
  });
}

// ── Live state ────────────────────────────────────────────────────

export interface Reading {
  v: number | boolean;
  /** Phenomenon time: when the state began, in epoch ms. */
  at: number;
}

type Sink = (id: number, reading: Reading) => void;

interface Session {
  ids: ReadonlySet<number>;
  sink: Sink;
  pollOnly: boolean;
}

const sessions = new Set<Session>();
/** How many sessions follow each datastream. */
const refs = new Map<number, number>();
/** Newest reading per followed datastream. */
const latest = new Map<number, Reading>();
let client: MqttClient | null = null;
let connected = false;
let lastMessageAt = 0;
let stalled = false;
let watchdog: ReturnType<typeof setInterval> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

const topic = (id: number): string => `v1.1/Datastreams(${id})/Observations`;
const TOPIC_ID = /^v1\.1\/Datastreams\((\d+)\)\/Observations$/;
const Message = z.object({ result: z.union([z.number(), z.boolean()]), phenomenonTime: z.string() });

function deliver(id: number, reading: Reading): void {
  const prev = latest.get(id);
  if (prev && (reading.at < prev.at || (reading.at === prev.at && reading.v === prev.v))) return;
  latest.set(id, reading);
  for (const s of sessions) if (!s.pollOnly && s.ids.has(id)) s.sink(id, reading);
}

function connect(): void {
  if (client) return;
  const c = mqtt.connect(BROKER, { clientId: `vantage-pulse-${Math.random().toString(16).slice(2, 10)}`, reconnectPeriod: 5_000, connectTimeout: 10_000, keepalive: 30, clean: true });
  client = c;
  lastMessageAt = Date.now();
  c.on("connect", () => {
    connected = true;
    const topics = [...refs.keys()].map(topic);
    if (topics.length) c.subscribe(topics, { qos: 0 });
    log.info("hamburg mqtt connected", { topics: topics.length });
  });
  c.on("message", (t, payload) => {
    const id = Number(TOPIC_ID.exec(t)?.[1]);
    if (!Number.isFinite(id)) return;
    let json: unknown;
    try {
      json = JSON.parse(payload.toString());
    } catch {
      return;
    }
    const msg = Message.safeParse(json);
    if (!msg.success) return;
    lastMessageAt = Date.now();
    stalled = false;
    const at = Date.parse(msg.data.phenomenonTime.split("/")[0] ?? "");
    deliver(id, { v: msg.data.result, at: Number.isFinite(at) ? at : Date.now() });
  });
  c.on("close", () => {
    connected = false;
  });
  c.on("error", (err) => log.warn("hamburg mqtt error", { error: err.message }));
}

function disconnect(): void {
  const c = client;
  client = null;
  connected = false;
  if (c) c.end(true);
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
}

const Delta = z.object({ value: z.array(z.object({ phenomenonTime: z.string(), result: z.union([z.number(), z.boolean()]), Datastream: z.object({ "@iot.id": z.number() }) })) });

/** REST: every observation of the given datastreams since a moment. Documented fallback for MQTT. */
async function pollDelta(ids: readonly number[], sinceMs: number): Promise<{ id: number; reading: Reading }[]> {
  const out: { id: number; reading: Reading }[] = [];
  const since = new Date(sinceMs).toISOString().replace(/\.\d+Z$/, "Z");
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const page = await fetchJson(
      SOURCE,
      rest("Observations", {
        $filter: `Datastream/id in (${chunk.join(",")}) and phenomenonTime gt ${since}`,
        $orderby: "phenomenonTime desc",
        $select: "phenomenonTime,result",
        $expand: "Datastream($select=@iot.id)",
        $top: "1000",
      }),
      Delta,
      { timeoutMs: 8_000 },
    );
    // Newest first, so a full page drops the oldest rows; deliver oldest first so the newest state wins.
    for (const o of page.value.reverse()) out.push({ id: o.Datastream["@iot.id"], reading: { v: o.result, at: Date.parse(o.phenomenonTime) } });
  }
  return out;
}

const SnapshotPage = z.object({ value: z.array(z.object({ "@iot.id": z.number(), Observations: z.array(z.object({ phenomenonTime: z.string(), result: z.union([z.number(), z.boolean()]) })) })) });

/** Latest state of datastreams, from REST. Only for the ones MQTT has not reported on since we started following them. */
async function fetchSnapshot(ids: readonly number[]): Promise<Map<number, Reading>> {
  const found = new Map<number, Reading>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += SNAPSHOT_CHUNK) chunks.push(ids.slice(i, i + SNAPSHOT_CHUNK));
  await Promise.all(
    chunks.map(async (chunk) => {
      const page = await fetchJson(
        SOURCE,
        rest("Datastreams", { $filter: `id in (${chunk.join(",")})`, $select: "@iot.id", $expand: "Observations($top=1;$orderby=phenomenonTime desc;$select=phenomenonTime,result)", $top: String(SNAPSHOT_CHUNK) }),
        SnapshotPage,
        { timeoutMs: 15_000 },
      );
      for (const row of page.value) {
        const o = row.Observations[0];
        if (o) found.set(row["@iot.id"], { v: o.result, at: Date.parse(o.phenomenonTime) });
      }
    }),
  );
  return found;
}

function followed(): number[] {
  return [...refs.keys()];
}

function startWatchdog(): void {
  if (watchdog) return;
  const gate = new Watchdog(Date.now(), { pollMs: POLL_MS, silenceMs: MQTT_SILENCE_MS, quietCheckMs: QUIET_CHECK_MS, maxBackoffMs: MAX_POLL_BACKOFF_MS, maxWindowMs: MAX_POLL_WINDOW_MS });
  watchdog = setInterval(() => {
    const ids = followed();
    if (ids.length === 0) return;
    const now = Date.now();
    // While MQTT delivers, REST stays quiet. After half a minute of silence it checks the city's server directly,
    // every 15 s; if REST sees changes MQTT missed, REST takes over at one request per two seconds until MQTT speaks again.
    const since = gate.begin(now, lastMessageAt, stalled);
    if (since === null) return;
    const silent = now - lastMessageAt > MQTT_SILENCE_MS;
    void pollDelta(ids, since)
      .then((found) => {
        gate.succeeded();
        if (found.length > 0) stalled = silent || stalled;
        for (const f of found) deliver(f.id, f.reading);
      })
      .catch((err: unknown) => {
        gate.failed(Date.now());
        log.warn("hamburg poll failed", { error: err instanceof Error ? err.message : String(err) });
      });
  }, POLL_MS);
}

/** Wait briefly for the broker connection so the first transport report is accurate. */
async function brokerReady(timeoutMs: number): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (!connected && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 100));
}

export function transportNow(): "mqtt" | "poll" {
  return connected && !stalled ? "mqtt" : "poll";
}

/** Follow datastreams until the returned function is called. Subscribes only what is new and unsubscribes what nobody follows any more. */
export function follow(ids: readonly number[], sink: Sink, options: { pollOnly?: boolean } = {}): () => void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const session: Session = { ids: new Set(ids), sink, pollOnly: options.pollOnly ?? false };
  sessions.add(session);

  if (session.pollOnly) {
    // REST only, and no MQTT subscription: this is the path that runs when the broker cannot be reached.
    let since = Date.now() - POLL_MS;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      const from = since;
      const started = Date.now();
      void pollDelta([...session.ids], from)
        .then((found) => {
          since = started - 1_000;
          for (const f of found) sink(f.id, f.reading);
        })
        .catch((err: unknown) => log.warn("hamburg poll failed", { error: err instanceof Error ? err.message : String(err) }))
        .finally(() => {
          busy = false;
        });
    }, POLL_MS);
    return () => {
      clearInterval(timer);
      sessions.delete(session);
    };
  }

  const fresh: number[] = [];
  for (const id of session.ids) {
    const n = refs.get(id) ?? 0;
    refs.set(id, n + 1);
    if (n === 0) fresh.push(id);
  }
  connect();
  startWatchdog();
  if (fresh.length && client && connected) client.subscribe(fresh.map(topic), { qos: 0 });

  return () => {
    sessions.delete(session);
    const gone: number[] = [];
    for (const id of session.ids) {
      const n = (refs.get(id) ?? 1) - 1;
      if (n <= 0) {
        refs.delete(id);
        latest.delete(id);
        gone.push(id);
      } else refs.set(id, n);
    }
    if (gone.length && client && connected) client.unsubscribe(gone.map(topic));
    if (sessions.size === 0) idleTimer = setTimeout(disconnect, IDLE_CLOSE_MS);
  };
}

// ── Stream ────────────────────────────────────────────────────────

const MAX_STREAMS = 6;
let openStreams = 0;

/** A queue that an async generator can wait on and a disconnect can cut short. */
class Wake {
  private items: SignalStreamEvent[] = [];
  private waiter: (() => void) | null = null;
  closed = false;
  push(e: SignalStreamEvent): void {
    this.items.push(e);
    this.waiter?.();
  }
  close(): void {
    this.closed = true;
    this.waiter?.();
  }
  async next(timeoutMs: number): Promise<SignalStreamEvent[]> {
    if (this.items.length === 0 && !this.closed) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, timeoutMs);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      this.waiter = null;
    }
    const out = this.items;
    this.items = [];
    return out;
  }
}

/** The state of the given datastreams now, then every change, as stream events. Ends when `signal` aborts. */
export async function* signalStream(ids: readonly number[], signal: AbortSignal, pollOnly: boolean): AsyncGenerator<SignalStreamEvent> {
  if (openStreams >= MAX_STREAMS) throw new HttpError(429, "too_many_streams", "Too many live signal streams are open. Close another City tab and retry.");
  openStreams++;
  const wake = new Wake();
  const onAbort = (): void => wake.close();
  signal.addEventListener("abort", onAbort);
  const stop = follow(ids, (id, r) => wake.push({ t: "state", id, v: r.v, at: r.at }), { pollOnly });
  try {
    if (!pollOnly) await brokerReady(3_000);
    yield { t: "transport", transport: pollOnly ? "poll" : transportNow() };
    const snapshot = await fetchSnapshot(pollOnly ? ids : ids.filter((id) => !latest.has(id)));
    for (const id of ids) {
      // MQTT may already have reported a newer state while the snapshot was loading.
      const fromRest = snapshot.get(id);
      if (fromRest && !pollOnly && !latest.has(id)) latest.set(id, fromRest);
      const r = pollOnly ? fromRest : latest.get(id);
      if (r) yield { t: "state", id, v: r.v, at: r.at };
    }
    let transport = pollOnly ? "poll" : transportNow();
    while (!wake.closed) {
      const events = await wake.next(15_000);
      for (const e of events) yield e;
      if (!pollOnly && transportNow() !== transport) {
        transport = transportNow();
        yield { t: "transport", transport };
      }
      if (events.length === 0 && !wake.closed) yield { t: "ping", at: Date.now() };
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    stop();
    openStreams--;
  }
}
