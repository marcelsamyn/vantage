import { api } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import type { GalileoStatus, Jamming } from "./types";

export const fetchJamming = (signal?: AbortSignal): Promise<Jamming> => api<Jamming>("/api/gnss/jamming", { signal });
export const fetchGalileo = (signal?: AbortSignal): Promise<GalileoStatus> => api<GalileoStatus>("/api/gnss/galileo", { signal });

/** gpsjam.org publishes one map per UTC day, so an hourly check is plenty. */
export const useJamming = (): Polled<Jamming> => usePoll((signal) => fetchJamming(signal), 3_600_000, []);

/** The service centre updates its table when something changes; a quarter-hourly check is polite and fresh enough. */
export const useGalileo = (): Polled<GalileoStatus> => usePoll((signal) => fetchGalileo(signal), 15 * 60_000, []);
