import { TransitClock } from "./clock";
import { vehicleKey } from "./fusion";
import type { TransitSnapshot, TripSegment } from "./types";

export interface TransitView { vehicles: TripSegment[]; notice: string | null }

/** Membership is local to a query; vehicle revisions are shared across queries. */
export class TransitSnapshots {
  private epoch: string | null = null;
  private readonly retired = new Set<string>();
  private readonly queries = new Map<string, TransitSnapshot>();
  private readonly vehicles = new Map<string, TripSegment>();
  private clock: { server: number; elapsed: number; generation: number } | null = null;
  private readonly fallback = new TransitClock();

  accepts(epoch: string): boolean { return this.epoch === null || this.epoch === epoch; }
  isRetired(epoch: string): boolean { return this.retired.has(epoch); }

  confirm(epoch: string): void {
    if (this.retired.has(epoch) || this.epoch === epoch) return;
    if (this.epoch) this.retired.add(this.epoch);
    this.epoch = epoch;
    this.queries.clear();
    this.vehicles.clear();
    this.clock = null;
  }

  ingest(snapshot: TransitSnapshot, sent: number, received: number): boolean {
    if (this.isRetired(snapshot.epoch) || !this.accepts(snapshot.epoch)) return false;
    this.epoch = snapshot.epoch;
    const old = this.queries.get(snapshot.queryKey);
    if (old && old.revision > snapshot.revision) return false;
    this.queries.delete(snapshot.queryKey);
    this.queries.set(snapshot.queryKey, snapshot);
    if (this.queries.size > 64) this.queries.delete(this.queries.keys().next().value ?? "");
    if (!this.clock || snapshot.serverTime >= this.clock.generation) {
      const networkMs = Math.max(0, received - sent - snapshot.durationMs);
      this.clock = { server: snapshot.serverTime + networkMs / 2, elapsed: received, generation: snapshot.serverTime };
    }
    for (const v of snapshot.vehicles) {
      const current = this.vehicles.get(vehicleKey(v));
      if (current?.tracking && v.tracking && current.tracking.revision > v.tracking.revision) continue;
      const path = v.tracking?.pathId ? snapshot.paths[v.tracking.pathId] : undefined;
      this.vehicles.delete(vehicleKey(v));
      this.vehicles.set(vehicleKey(v), path && v.tracking ? { ...v, tracking: { ...v.tracking, path } } : v);
    }
    while (this.vehicles.size > 4000) this.vehicles.delete(this.vehicles.keys().next().value ?? "");
    return true;
  }

  view(queryKey: string): TransitView {
    const snapshot = this.queries.get(queryKey);
    const errors = snapshot?.sources.filter(s => s.error).map(s => `${s.source}: ${s.error}`) ?? [];
    if (snapshot && snapshot.clockErrorMs > 5000) errors.push("Tracking clock changed. Restart VANTAGE to restore tracking.");
    return { vehicles: snapshot?.vehicles.map(v => this.vehicles.get(vehicleKey(v)) ?? v) ?? [], notice: errors.length ? `Vehicle reports delayed · ${errors.join(" · ")}` : null };
  }

  now(elapsed = performance.now()): number { return this.clock ? this.clock.server + elapsed - this.clock.elapsed : this.fallback.now(); }
}
