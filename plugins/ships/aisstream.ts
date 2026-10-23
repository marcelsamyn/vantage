import type { AisPosition, AisStatic } from "./ais-decoder";
import type { StreamState, TrackedVessel } from "./ais-stream";
import type { Box } from "./client";
import type { ShipSafetyReport } from "./types";

export type GlobalReport =
  | { kind: "confirmed"; compressed: boolean }
  | { kind: "error" }
  | { kind: "position"; position: AisPosition; name: string | null; at: number; info?: Omit<AisStatic, "kind" | "mmsi">; reportKind?: "sar-aircraft"; altitudeM?: number | null }
  | { kind: "static"; mmsi: number; info: Omit<AisStatic, "kind" | "mmsi"> }
  | { kind: "safety"; mmsi: number; report: ShipSafetyReport };

export interface GlobalTrackedVessel extends TrackedVessel {
  reportKind?: "sar-aircraft";
  altitudeM?: number | null;
  safetyReports: ShipSafetyReport[];
}

interface RecordState {
  updatedAt: number;
  vessel: GlobalTrackedVessel | null;
  info: Omit<AisStatic, "kind" | "mmsi">;
  safetyReports: ShipSafetyReport[];
}

interface Options {
  key: string;
  parse: (data: unknown) => GlobalReport | null;
  /** Tests replace only the external transport with a real loopback WebSocket server. */
  connect?: () => WebSocket;
  idleCloseMs?: number;
  staleMs?: number;
  maxRecords?: number;
  tickMs?: number;
  retryMs?: number;
  connectTimeoutMs?: number;
}

const TYPES = ["PositionReport", "StandardClassBPositionReport", "ExtendedClassBPositionReport", "LongRangeAisBroadcastMessage", "ShipStaticData", "StaticDataReport", "SafetyBroadcastMessage", "AddressedSafetyMessage", "StandardSearchAndRescueAircraftReport"];

/** AIS Stream uses latitude/longitude corners. A wrapped view needs two ordinary boxes. */
export function subscriptionBoxes(boxes: readonly Box[]): number[][][] {
  return boxes.flatMap((b) => b.west <= b.east ? [[[b.south, b.west], [b.north, b.east]]] : [[[b.south, b.west], [b.north, 180]], [[b.south, -180], [b.north, b.east]]]);
}

const inside = (v: AisPosition, b: Box): boolean => v.lat >= b.south && v.lat <= b.north && (b.west <= b.east ? v.lon >= b.west && v.lon <= b.east : v.lon >= b.west || v.lon <= b.east);

/** One backend socket for the recently requested areas. No browser request means no connection or retry. */
export class GlobalAisStream {
  state: StreamState = "idle";
  error: string | null = null;
  compressed: boolean | null = null;
  private socket: WebSocket | null = null;
  private readonly areas = new Map<string, { box: Box; at: number }>();
  private readonly records = new Map<number, RecordState>();
  private readonly timer: ReturnType<typeof setInterval>;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSubscription = "";
  private sentAt = 0;
  private attempts = 0;
  private generation = 0;
  private readonly idleCloseMs: number;
  private readonly staleMs: number;

  constructor(private readonly options: Options) {
    this.idleCloseMs = options.idleCloseMs ?? 120_000;
    this.staleMs = options.staleMs ?? 20 * 60_000;
    this.timer = setInterval(() => this.tick(), options.tickMs ?? 1000);
    this.timer.unref();
  }

  want(box: Box): void {
    const id = `${box.west},${box.south},${box.east},${box.north}`;
    this.areas.delete(id);
    this.areas.set(id, { box, at: Date.now() });
    // Old panning areas expire; a busy group of clients cannot grow a subscription without limit.
    if (this.areas.size > 32) {
      const oldest = this.areas.keys().next().value;
      if (oldest !== undefined) this.areas.delete(oldest);
    }
    if (this.state === "idle" || (this.state === "unreachable" && !this.retryTimer)) this.connect();
    else this.subscribe();
  }

  within(box: Box): GlobalTrackedVessel[] {
    return [...this.records.values()].flatMap((r) => r.vessel && Date.now() - r.vessel.at <= this.staleMs && inside(r.vessel.position, box) ? [{ ...r.vessel, info: r.info, safetyReports: r.safetyReports }] : []);
  }

  find(mmsi: number): GlobalTrackedVessel | null {
    const record = this.records.get(mmsi);
    return record?.vessel && Date.now() - record.vessel.at <= this.staleMs ? { ...record.vessel, info: record.info, safetyReports: record.safetyReports } : null;
  }

  close(): void {
    this.generation++;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.retryTimer = null;
    this.connectTimer = null;
    this.socket?.close();
    this.socket = null;
    this.state = "idle";
    this.compressed = null;
    this.lastSubscription = "";
  }

  dispose(): void {
    this.close();
    clearInterval(this.timer);
  }

  private connect(): void {
    const generation = ++this.generation;
    const current = (): boolean => this.generation === generation;
    this.state = "connecting";
    this.compressed = null;
    this.lastSubscription = "";
    this.sentAt = 0;
    let socket: WebSocket;
    try {
      // Bun's WebSocket client negotiates permessage-deflate by default.
      socket = this.options.connect?.() ?? new WebSocket("wss://stream.aisstream.io/v0/stream");
    } catch {
      this.fail("AIS Stream could not connect. Check the network and restart the server if needed.");
      return;
    }
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    this.connectTimer = setTimeout(() => { if (current()) this.fail("AIS Stream did not confirm the subscription. Check the API key and account connection limit."); }, this.options.connectTimeoutMs ?? 10_000);
    this.connectTimer.unref();
    socket.onopen = () => { if (current()) this.subscribe(); };
    socket.onclose = () => { if (current()) this.fail("AIS Stream disconnected. The server will retry while ships are open."); };
    socket.onerror = () => { if (current()) this.fail("AIS Stream is unreachable. Check the network and API key."); };
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (!current()) return;
      try {
        const text = typeof event.data === "string" ? event.data : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : null;
        if (text === null || text.length > 64_000) throw new Error("Unsupported frame");
        const data: unknown = JSON.parse(text);
        const report = this.options.parse(data);
        if (report?.kind === "error") {
          this.fail("AIS Stream rejected the subscription. Check VANTAGE_AISSTREAM_KEY and the account connection limit.");
          return;
        }
        if (report) {
          if (this.connectTimer) clearTimeout(this.connectTimer);
          this.connectTimer = null;
          this.state = "connected";
          this.error = null;
          this.attempts = 0;
        }
        if (report?.kind === "confirmed") this.compressed = report.compressed;
        else if (report) this.store(report);
      } catch {
        // Upstream text and validation errors can contain the subscription key. Expose only a fixed diagnosis.
        this.fail("AIS Stream sent invalid message data. The server will reconnect while ships are open.");
      }
    };
  }

  private subscribe(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || this.areas.size === 0) return;
    const areas = [...this.areas].sort(([a], [b]) => a.localeCompare(b));
    const boxes = subscriptionBoxes(areas.map(([, area]) => area.box));
    const signature = JSON.stringify(boxes);
    if (signature === this.lastSubscription || (this.sentAt > 0 && Date.now() - this.sentAt < 1100)) return;
    try {
      this.socket.send(JSON.stringify({ APIKey: this.options.key, BoundingBoxes: boxes, FilterMessageTypes: TYPES }));
      this.sentAt = Date.now();
      this.lastSubscription = signature;
    } catch {
      this.fail("AIS Stream could not receive the subscription. The server will retry while ships are open.");
    }
  }

  private fail(message: string): void {
    this.close();
    this.state = "unreachable";
    this.error = message;
    const base = this.options.retryMs ?? 5000;
    const delay = Math.min(base * 2 ** Math.min(this.attempts++, 5), 120_000) * (1 + Math.random() * 0.2);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.expireAreas();
      if (this.areas.size > 0) this.connect();
      else this.state = "idle";
    }, delay);
    this.retryTimer.unref();
  }

  private store(report: Exclude<GlobalReport, { kind: "confirmed" } | { kind: "error" }>): void {
    const mmsi = report.kind === "position" ? report.position.mmsi : report.mmsi;
    const record = this.records.get(mmsi) ?? { updatedAt: 0, vessel: null, info: {}, safetyReports: [] };
    record.updatedAt = Date.now();
    if (report.kind === "position") {
      record.info = { ...record.info, ...report.info, ...(report.name && !record.info.name ? { name: report.name } : {}) };
      if (!record.vessel || report.at >= record.vessel.at) record.vessel = { position: report.position, at: report.at, info: record.info, reportKind: report.reportKind, altitudeM: report.altitudeM, safetyReports: record.safetyReports };
    } else if (report.kind === "static") record.info = { ...record.info, ...report.info };
    else if (!record.safetyReports.some((s) => s.text === report.report.text && s.recipientMmsi === report.report.recipientMmsi && s.at === report.report.at)) record.safetyReports = [...record.safetyReports, report.report].slice(-5);
    this.records.delete(mmsi);
    this.records.set(mmsi, record);
    if (this.records.size > (this.options.maxRecords ?? 10_000)) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
  }

  private expireAreas(): void {
    const now = Date.now();
    for (const [id, area] of this.areas) if (now - area.at > this.idleCloseMs) this.areas.delete(id);
  }

  private tick(): void {
    this.expireAreas();
    if (this.areas.size === 0 && this.state !== "idle") this.close();
    else this.subscribe();
    const now = Date.now();
    for (const [id, record] of this.records) {
      if (now - record.updatedAt > this.staleMs) this.records.delete(id);
      else record.safetyReports = record.safetyReports.filter((s) => now - s.at <= this.staleMs);
    }
  }
}
