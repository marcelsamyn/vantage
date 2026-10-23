import { api, post } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { PhoneStatus } from "./types";

const POLL_MS = 5_000;

export const fetchStatus = (signal?: AbortSignal): Promise<PhoneStatus> => api<PhoneStatus>("/api/phone/status", { signal });

/** Turn Tailscale Serve for VANTAGE on or off. Resolves with the status after the change. */
export const setSharing = (on: boolean): Promise<PhoneStatus> => post<PhoneStatus>("/api/phone/share", { on });

export function usePhoneStatus(): Polled<PhoneStatus> {
  return usePoll((signal) => fetchStatus(signal), POLL_MS, []);
}
