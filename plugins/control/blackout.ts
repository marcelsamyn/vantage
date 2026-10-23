import { act } from "./client";
import type { Device } from "./types";

/**
 * Blackout: one action that pauses media, turns off lights and sleeps the display. Devices opt in per capability
 * with `blackout`, which also names the step. Media goes quiet first and the display sleeps last.
 */

export interface BlackoutStep {
  device: Device;
  capability: string;
  text: string;
  run: () => Promise<boolean>;
}

const ORDER = { media: 0, switch: 1, action: 2 } as const;

export function blackoutPlan(devices: readonly Device[]): BlackoutStep[] {
  const steps: (BlackoutStep & { order: number })[] = [];
  for (const device of devices) {
    if (!device.online) continue;
    for (const c of device.capabilities) {
      if (c.kind === "media" && c.blackout) steps.push({ device, capability: c.id, text: c.blackout, order: ORDER.media, run: () => act<"media">(device, c.id, "pause") });
      if (c.kind === "switch" && c.blackout) steps.push({ device, capability: c.id, text: c.blackout, order: ORDER.switch, run: () => act<"switch">(device, c.id, false) });
      if (c.kind === "action" && c.blackout) steps.push({ device, capability: c.id, text: c.blackout, order: ORDER.action, run: () => act<"action">(device, c.id, null) });
    }
  }
  return steps.sort((a, b) => a.order - b.order);
}

/** Run every step in order. Returns the steps that failed. */
export async function runBlackout(steps: readonly BlackoutStep[]): Promise<BlackoutStep[]> {
  const failed: BlackoutStep[] = [];
  for (const step of steps) if (!(await step.run())) failed.push(step);
  return failed;
}
