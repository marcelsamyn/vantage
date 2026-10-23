import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { api, errorMessage, post, qs } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import type { ActKind, ActRequest, ActValues, Capability, ControlDevices, Device, PairRequest } from "./types";

// ── Fetchers ──────────────────────────────────────────────────────

export const fetchDevices = (refresh: boolean, signal?: AbortSignal): Promise<ControlDevices> =>
  api<ControlDevices>(qs("/api/control/devices", { refresh: refresh ? 1 : undefined }), { signal });

export interface DevicesPoll extends Polled<ControlDevices> {
  /** Browse the network again and re-read every device. */
  rescan: () => void;
}

/** Devices and their state. Polls faster while a network scan runs, so new devices appear as soon as it ends. */
export function useDevices(intervalMs = 5_000): DevicesPoll {
  const rescanNext = useRef(false);
  const [scanning, setScanning] = useState(false);
  const poll = usePoll(
    async (signal) => {
      const refresh = rescanNext.current;
      rescanNext.current = false;
      const data = await fetchDevices(refresh, signal);
      setScanning(data.scanning);
      return data;
    },
    scanning ? 1_500 : intervalMs,
    [],
  );
  const { refresh } = poll;
  useEffect(() => onDevicesChanged(refresh), [refresh]);
  return {
    ...poll,
    rescan: () => {
      rescanNext.current = true;
      refresh();
    },
  };
}

// ── Shared UI state: selection, pulses on the constellation, pending actions ──

export interface Pulse {
  id: number;
  deviceId: string;
  failed: boolean;
}

interface ControlStore {
  selected: string | null;
  pulses: Pulse[];
  /** "<deviceId>|<capability>" while an action is on its way. */
  busy: Record<string, true>;
  /** Last failure per device, in plain words. */
  errors: Record<string, string>;
  select: (id: string | null) => void;
}

export const useControl = create<ControlStore>((set) => ({
  selected: null,
  pulses: [],
  busy: {},
  errors: {},
  select: (selected) => set({ selected }),
}));

let pulseCounter = 0;
function pulse(deviceId: string, failed = false): void {
  const id = ++pulseCounter;
  useControl.setState((s) => ({ pulses: [...s.pulses, { id, deviceId, failed }].slice(-12) }));
  setTimeout(() => useControl.setState((s) => ({ pulses: s.pulses.filter((p) => p.id !== id) })), 1_400);
}

const busyKey = (deviceId: string, capability: string): string => `${deviceId}|${capability}`;
export const useBusy = (deviceId: string, capability: string): boolean => useControl((s) => Boolean(s.busy[busyKey(deviceId, capability)]));

function setBusy(key: string, on: boolean): void {
  useControl.setState((s) => {
    const busy = { ...s.busy };
    if (on) busy[key] = true;
    else delete busy[key];
    return { busy };
  });
}

function setError(deviceId: string, message: string | null): void {
  useControl.setState((s) => {
    const errors = { ...s.errors };
    if (message) errors[deviceId] = message;
    else delete errors[deviceId];
    return { errors };
  });
}

/** Listeners that re-read devices after an action, so every view shows the new state at once. */
const changed = new Set<() => void>();
export function onDevicesChanged(listener: () => void): () => void {
  changed.add(listener);
  return () => changed.delete(listener);
}

/** Send one action. A pulse runs out to the device on the constellation; a failure is kept for the device's panel. */
export async function act<K extends ActKind>(device: Device, capability: string, value: ActValues[K]): Promise<boolean> {
  const key = busyKey(device.id, capability);
  setBusy(key, true);
  setError(device.id, null);
  pulse(device.id);
  try {
    await post<Device>("/api/control/act", { deviceId: device.id, capability, value } satisfies ActRequest<K>);
    return true;
  } catch (err) {
    setError(device.id, errorMessage(err));
    pulse(device.id, true);
    sfx.alert();
    return false;
  } finally {
    setBusy(key, false);
    for (const listener of changed) listener();
  }
}

export async function pairDevice(device: Device): Promise<boolean> {
  const key = busyKey(device.id, "pair");
  setBusy(key, true);
  setError(device.id, null);
  try {
    await post<Device>("/api/control/pair", { deviceId: device.id } satisfies PairRequest);
    sfx.lock();
    return true;
  } catch (err) {
    setError(device.id, errorMessage(err));
    return false;
  } finally {
    setBusy(key, false);
    for (const listener of changed) listener();
  }
}

// ── Reading capabilities ──────────────────────────────────────────

export function capabilityOf<K extends Capability["kind"]>(device: Device | undefined, kind: K, id?: string): Extract<Capability, { kind: K }> | undefined {
  return device?.capabilities.find((c): c is Extract<Capability, { kind: K }> => c.kind === kind && (id === undefined || c.id === id));
}

/** The Mac VANTAGE runs on: the centre of the constellation. */
export const thisMac = (devices: readonly Device[]): Device | undefined => devices.find((d) => d.kind === "computer" && d.local);

/** Below this a supply counts as low, for the tile, the Printers panel and the watcher. */
export const LOW_SUPPLY_PERCENT = 15;
