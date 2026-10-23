/**
 * A small GTFS-Realtime decoder. GTFS-RT is a protobuf format; we only need a handful of fields,
 * so reading the wire format directly is shorter than a protobuf library and adds no dependency.
 * Field numbers follow https://github.com/google/transit/blob/master/gtfs-realtime/proto/gtfs-realtime.proto
 */

import type { Occupancy } from "./types";
import { z } from "zod";

const OCCUPANCY: Record<number, Occupancy | undefined> = { 0: "empty", 1: "many_seats", 2: "few_seats", 3: "standing", 4: "crushed", 5: "full", 6: "closed" };

export interface RtVehicle {
  /** Feed entity id; unique inside one feed. */
  id: string;
  tripId: string;
  routeId: string;
  /** Vehicle label or id as the operator publishes it. */
  label: string;
  vehicleId?: string;
  serviceDate?: string;
  startTime?: string;
  stopSequence?: number | null;
  stopStatus?: "incoming" | "stopped" | "moving" | null;
  lat: number;
  lon: number;
  bearing: number | null;
  speedMs: number | null;
  stopId: string;
  /** Epoch seconds of the position fix, 0 when absent. */
  timestamp: number;
  receivedAt?: number;
  producedAt?: number;
  occupancy: Occupancy | null;
}

export interface RtStopUpdate {
  stopId: string;
  /** Seconds late at arrival; negative is early. Null when the feed gives only an absolute time. */
  arrivalDelay: number | null;
  departureDelay: number | null;
}

export interface RtTripUpdate {
  tripId: string;
  routeId: string;
  stops: RtStopUpdate[];
}

export interface RtFeed {
  /** Epoch seconds the feed was produced. */
  timestamp: number;
  vehicles: RtVehicle[];
  tripUpdates: RtTripUpdate[];
}

/** Sequential reader over one protobuf message. */
class Reader {
  pos: number;
  /** Low and high 32 bits of the last varint read. */
  private lo = 0;
  private hi = 0;
  private readonly view: DataView;
  private static readonly text = new TextDecoder();

  constructor(
    private readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
  ) {
    this.pos = start;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  private varint(): void {
    let lo = 0;
    let hi = 0;
    let shift = 0;
    for (;;) {
      if (this.pos >= this.end) throw new Error("GTFS-RT: truncated varint");
      const b = this.buf[this.pos++] ?? 0;
      if (shift < 28) lo |= (b & 0x7f) << shift;
      else if (shift === 28) {
        lo |= (b & 0x0f) << 28;
        hi |= (b & 0x7f) >> 4;
      } else if (shift < 64) hi |= (b & 0x7f) << (shift - 32);
      if (!(b & 0x80)) break;
      shift += 7;
      if (shift > 70) throw new Error("GTFS-RT: varint too long");
    }
    this.lo = lo >>> 0;
    this.hi = hi >>> 0;
  }

  /** Next field header: field number and wire type. */
  tag(): { field: number; wire: number } {
    this.varint();
    return { field: (this.lo >>> 3) | ((this.hi & 0x7) << 29), wire: this.lo & 7 };
  }

  /** Unsigned varint; exact up to 2^53, which covers epoch seconds. */
  uint(): number {
    this.varint();
    return this.hi * 4_294_967_296 + this.lo;
  }

  /** Signed 32-bit varint (negative values arrive sign-extended to 64 bits). */
  int32(): number {
    this.varint();
    return this.lo | 0;
  }

  float(): number {
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** A length-delimited field: returns a reader over its payload. */
  message(): Reader {
    const len = this.uint();
    const r = new Reader(this.buf, this.pos, this.pos + len);
    if (r.end > this.end) throw new Error("GTFS-RT: message longer than its parent");
    this.pos = r.end;
    return r;
  }

  string(): string {
    const m = this.message();
    return Reader.text.decode(this.buf.subarray(m.pos, m.end));
  }

  /** Skip a field the caller does not need. */
  skip(wire: number): void {
    switch (wire) {
      case 0:
        this.varint();
        return;
      case 1:
        this.pos += 8;
        return;
      case 2:
        this.message();
        return;
      case 5:
        this.pos += 4;
        return;
      default:
        throw new Error(`GTFS-RT: unsupported wire type ${wire}`);
    }
  }
}

interface TripDescriptor {
  tripId: string;
  routeId: string;
  serviceDate?: string;
  startTime?: string;
}

function readTrip(r: Reader): TripDescriptor {
  const t: TripDescriptor = { tripId: "", routeId: "" };
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) t.tripId = r.string();
    else if (field === 2 && wire === 2) t.startTime = r.string();
    else if (field === 3 && wire === 2) t.serviceDate = r.string();
    else if (field === 5 && wire === 2) t.routeId = r.string();
    else r.skip(wire);
  }
  return t;
}

function readVehicleLabel(r: Reader): { id: string; label: string } {
  let id = "";
  let label = "";
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) id = r.string();
    else if (field === 2 && wire === 2) label = r.string();
    else r.skip(wire);
  }
  return { id, label: label || id };
}

export const RtVehicleShape = z.object({
  receivedAt: z.number().positive().optional(), producedAt: z.number().positive().optional(),
  id: z.string(), tripId: z.string(), routeId: z.string(), label: z.string(), stopId: z.string(), vehicleId: z.string().optional(),
  serviceDate: z.string().optional(), startTime: z.string().optional(), stopSequence: z.number().int().nonnegative().nullable().optional(), stopStatus: z.enum(["incoming", "stopped", "moving"]).nullable().optional(),
  lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180), timestamp: z.number().nonnegative(), bearing: z.number().min(0).max(360).nullable(), speedMs: z.number().nonnegative().nullable(),
  occupancy: z.enum(["empty", "many_seats", "few_seats", "standing", "crushed", "full", "closed"]).nullable(),
});

function readVehicle(id: string, r: Reader): RtVehicle | null {
  const v: RtVehicle = { id, tripId: "", routeId: "", label: "", lat: NaN, lon: NaN, bearing: null, speedMs: null, stopId: "", timestamp: 0, occupancy: null };
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) {
      const t = readTrip(r.message());
      v.tripId = t.tripId;
      v.routeId = t.routeId;
      v.serviceDate = t.serviceDate;
      v.startTime = t.startTime;
    } else if (field === 2 && wire === 2) {
      const p = r.message();
      while (!p.done) {
        const f = p.tag();
        if (f.wire !== 5) p.skip(f.wire);
        else if (f.field === 1) v.lat = p.float();
        else if (f.field === 2) v.lon = p.float();
        else if (f.field === 3) v.bearing = p.float();
        else if (f.field === 5) v.speedMs = p.float();
        else p.skip(f.wire);
      }
    } else if (field === 3 && wire === 0) v.stopSequence = r.uint();
    else if (field === 4 && wire === 0) {
      const status = r.uint();
      v.stopStatus = status === 0 ? "incoming" : status === 1 ? "stopped" : status === 2 ? "moving" : null;
    } else if (field === 5 && wire === 0) v.timestamp = r.uint();
    else if (field === 7 && wire === 2) v.stopId = r.string();
    else if (field === 8 && wire === 2) {
      const descriptor = readVehicleLabel(r.message());
      v.label = descriptor.label;
      v.vehicleId = descriptor.id;
    }
    else if (field === 9 && wire === 0) v.occupancy = OCCUPANCY[r.uint()] ?? null;
    else r.skip(wire);
  }
  const parsed = RtVehicleShape.safeParse(v);
  return parsed.success ? parsed.data : null;
}

function readStopEvent(r: Reader): number | null {
  let delay: number | null = null;
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 0) delay = r.int32();
    else r.skip(wire);
  }
  return delay;
}

function readTripUpdate(r: Reader): RtTripUpdate {
  const u: RtTripUpdate = { tripId: "", routeId: "", stops: [] };
  while (!r.done) {
    const { field, wire } = r.tag();
    if (field === 1 && wire === 2) {
      const t = readTrip(r.message());
      u.tripId = t.tripId;
      u.routeId = t.routeId;
    } else if (field === 2 && wire === 2) {
      const s = r.message();
      const stop: RtStopUpdate = { stopId: "", arrivalDelay: null, departureDelay: null };
      while (!s.done) {
        const f = s.tag();
        if (f.field === 2 && f.wire === 2) stop.arrivalDelay = readStopEvent(s.message());
        else if (f.field === 3 && f.wire === 2) stop.departureDelay = readStopEvent(s.message());
        else if (f.field === 4 && f.wire === 2) stop.stopId = s.string();
        else s.skip(f.wire);
      }
      u.stops.push(stop);
    } else r.skip(wire);
  }
  return u;
}

/** Decode the vehicle positions and trip updates of a GTFS-Realtime feed. */
export function decodeFeed(bytes: Uint8Array): RtFeed {
  const feed: RtFeed = { timestamp: 0, vehicles: [], tripUpdates: [] };
  const root = new Reader(bytes);
  while (!root.done) {
    const { field, wire } = root.tag();
    if (field === 1 && wire === 2) {
      const h = root.message();
      while (!h.done) {
        const f = h.tag();
        if (f.field === 3 && f.wire === 0) feed.timestamp = h.uint();
        else h.skip(f.wire);
      }
    } else if (field === 2 && wire === 2) {
      const e = root.message();
      let id = "";
      let deleted = false;
      let vehicle: Reader | null = null;
      let update: Reader | null = null;
      while (!e.done) {
        const f = e.tag();
        if (f.field === 1 && f.wire === 2) id = e.string();
        else if (f.field === 2 && f.wire === 0) deleted = e.uint() !== 0;
        else if (f.field === 3 && f.wire === 2) update = e.message();
        else if (f.field === 4 && f.wire === 2) vehicle = e.message();
        else e.skip(f.wire);
      }
      if (deleted) continue;
      if (vehicle) {
        const v = readVehicle(id, vehicle);
        if (v) feed.vehicles.push(v);
      }
      if (update) feed.tripUpdates.push(readTripUpdate(update));
    } else root.skip(wire);
  }
  return feed;
}
