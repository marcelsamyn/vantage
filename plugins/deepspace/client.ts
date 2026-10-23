import { useEffect, useState } from "react";
import { api, qs } from "../../app/core/api";
import { usePoll, type Polled } from "../../app/core/hooks";
import { profile } from "../../app/core/profile";
import type { ComplexId, DsnSnapshot, SpacecraftProfile, SpacecraftRef, SystemSnapshot } from "./types";

/** NASA refreshes its own page every 5 s and the server keeps a reading for 10 s. */
const DSN_POLL_MS = 10_000;
/** While JPL is still being asked for bodies the server answers with what it has. */
const SYSTEM_LOADING_POLL_MS = 3_000;
const SYSTEM_POLL_MS = 90_000;

export const fetchDsn = (signal: AbortSignal): Promise<DsnSnapshot> => api<DsnSnapshot>("/api/deepspace/dsn", { signal });
export const fetchSystem = (signal: AbortSignal): Promise<SystemSnapshot> => api<SystemSnapshot>("/api/deepspace/system", { signal });
export const fetchSpacecraft = (id: number, signal: AbortSignal): Promise<SpacecraftProfile> => api<SpacecraftProfile>(qs("/api/deepspace/spacecraft", { id }), { signal });

export const useDsn = (): Polled<DsnSnapshot> => usePoll(fetchDsn, DSN_POLL_MS, []);

/** The solar system, polled quickly until JPL has answered for every body and slowly after that. */
export function useSystem(): Polled<SystemSnapshot> {
  const [loading, setLoading] = useState(true);
  const polled = usePoll(fetchSystem, loading ? SYSTEM_LOADING_POLL_MS : SYSTEM_POLL_MS, [loading]);
  const pending = polled.data?.pending;
  useEffect(() => {
    if (pending !== undefined) setLoading(pending > 0);
  }, [pending]);
  return polled;
}

export function openSpacecraft(ref: SpacecraftRef): void {
  profile.open({ kind: "spacecraft", id: String(ref.naifId), data: ref });
}

/** Where each complex stands, for people who have never heard of it. */
export const COMPLEX_PLACE: Record<ComplexId, { place: string; country: string }> = {
  mdscc: { place: "Robledo de Chavela", country: "Spain" },
  gdscc: { place: "Mojave Desert, California", country: "United States" },
  cdscc: { place: "Tidbinbilla, near Canberra", country: "Australia" },
};

export const complexName = (dsn: DsnSnapshot, id: ComplexId): string => dsn.complexes.find((c) => c.id === id)?.name ?? id;
