import { distanceM } from "../../shared/geo";
import { positionAt, vehicleKey, type VehiclePosition } from "./fusion";
import { pointOnPath } from "./geometry";
import type { TripSegment } from "./types";

interface Drawn {
  revision: number;
  position: VehiclePosition;
  seen: number;
  began: number;
  offset: number;
  fade: boolean;
}

export class VehicleDisplay {
  private readonly drawn = new Map<string, Drawn>();

  position(vehicle: TripSegment, now: number, elapsed: number, reduced: boolean): { at: VehiclePosition; opacity: number } | null {
    const target = positionAt(vehicle, now);
    const key = vehicleKey(vehicle);
    if (!target) { this.drawn.delete(key); return null; }
    const revision = vehicle.tracking?.revision ?? vehicle.fix?.at ?? 0;
    let old = this.drawn.get(key);
    if (!old || elapsed - old.seen > 1000 || reduced) old = { revision, position: target, seen: elapsed, began: elapsed, offset: 0, fade: false };
    if (old.revision !== revision) {
      const error = distanceM(old.position, target);
      const difference = (old.position.s ?? 0) - (target.s ?? 0);
      // A half-second correction also needs a plausible acceleration, so only sub-metre errors glide.
      const glide = old.position.pathId === target.pathId && target.s !== undefined && old.position.s !== undefined && difference <= 0 && Math.abs(difference) < 0.08;
      old = { revision, position: old.position, seen: elapsed, began: elapsed, offset: glide ? difference : 0, fade: !glide && (error > 10 || old.position.pathId !== target.pathId) };
    }
    const fraction = Math.min(1, Math.max(0, (elapsed - old.began) / 500));
    const s = target.s === undefined ? undefined : target.s + old.offset * (1 - fraction);
    const coordinate = s !== undefined && vehicle.tracking?.path ? pointOnPath(vehicle.tracking.path, s, vehicle.tracking.states[0]?.section ?? 0) : null;
    const at = coordinate && distanceM(coordinate, target) <= 10 ? { ...target, ...coordinate, s } : target;
    this.drawn.set(key, { ...old, position: at, seen: elapsed });
    if (this.drawn.size > 2000) this.drawn.delete(this.drawn.keys().next().value ?? "");
    return { at, opacity: old.fade ? Math.min(1, (elapsed - old.began) / 150) : 1 };
  }
}
