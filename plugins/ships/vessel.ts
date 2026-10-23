import { FLAG_BY_MID } from "./flags";
import type { ShipCategory, ShipsNear } from "./types";

/** Plain-language meanings of the codes vessels broadcast. */

/** The flag state from the Maritime Identification Digits at the start of a vessel's MMSI; null for coast stations and unknown codes. */
export function flagOf(mmsi: number): string | null {
  const s = String(mmsi).padStart(9, "0");
  // 00MID… coast stations, 0MID… groups, 98MID… craft tied to a mother ship, 99MID… aids to navigation.
  if (s.startsWith("00")) return null;
  const mid = s.startsWith("98") || s.startsWith("99") ? s.slice(2, 5) : s.startsWith("0") ? s.slice(1, 4) : s.slice(0, 3);
  return FLAG_BY_MID[Number(mid)] ?? null;
}

export function categoryOf(shipType: number | null): ShipCategory {
  if (shipType === null) return "other";
  if (shipType >= 60 && shipType <= 69) return "passenger";
  if (shipType >= 70 && shipType <= 79) return "cargo";
  if (shipType >= 80 && shipType <= 89) return "tanker";
  if (shipType === 30) return "fishing";
  if (shipType === 36 || shipType === 37) return "pleasure";
  return "other";
}

const TENS: Record<number, string> = {
  20: "Wing-in-ground craft",
  40: "High-speed craft",
  60: "Passenger ship",
  70: "Cargo ship",
  80: "Tanker",
  90: "Other vessel",
};

const EXACT: Record<number, string> = {
  30: "Fishing vessel",
  31: "Towing vessel",
  32: "Towing vessel (large tow)",
  33: "Dredger or underwater works",
  34: "Diving support vessel",
  35: "Military vessel",
  36: "Sailing vessel",
  37: "Pleasure craft",
  50: "Pilot vessel",
  51: "Search and rescue vessel",
  52: "Tug",
  53: "Port tender",
  54: "Anti-pollution vessel",
  55: "Law enforcement vessel",
  58: "Medical transport",
  59: "Non-combatant ship",
};

export function shipTypeName(shipType: number | null): string {
  if (shipType === null || shipType === 0) return "Vessel";
  return EXACT[shipType] ?? TENS[Math.floor(shipType / 10) * 10] ?? "Vessel";
}

const NAV_STATUS: Record<number, string> = {
  0: "Under way using engine",
  1: "At anchor",
  2: "Not under command",
  3: "Restricted manoeuvrability",
  4: "Constrained by draught",
  5: "Moored",
  6: "Aground",
  7: "Engaged in fishing",
  8: "Under way sailing",
  11: "Towing astern",
  12: "Pushing ahead or towing alongside",
  14: "Emergency beacon active",
};

export const navStatusName = (status: number | null): string | null => (status === null ? null : (NAV_STATUS[status] ?? null));

/**
 * Estimated arrival from the packed AIS fields. The message holds no year, so the next date that matches is taken, unless it is
 * more than a month in the past, which means the vessel is late and not a year away.
 */
export function etaMs(eta: [number, number, number, number] | null | undefined, now = Date.now()): number | null {
  if (!eta) return null;
  const [month, day, hour, minute] = eta;
  const year = new Date(now).getUTCFullYear();
  let t = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(t).getUTCMonth() !== month - 1) return null; // 31 June and the like
  if (t < now - 31 * 86_400_000) t = Date.UTC(year + 1, month - 1, day, hour, minute);
  // Vessels announce arrivals days ahead, not months; a date further away is a leftover from an old voyage.
  return t - now > 120 * 86_400_000 ? null : t;
}

/** Digitraffic packs the ETA into one integer using the AIS bit layout: month (4 bits), day (5), hour (5), minute (6). */
export function unpackEta(packed: number | null | undefined): [number, number, number, number] | null {
  if (!packed) return null;
  const month = (packed >> 16) & 0xf;
  const day = (packed >> 11) & 0x1f;
  const hour = (packed >> 6) & 0x1f;
  const minute = packed & 0x3f;
  return month === 0 || day === 0 || hour > 23 || minute > 59 ? null : [month, day, hour, minute];
}

/** Explain an empty result, including the optional wider feed's setup step. */
export function shipSourceProblem(data: ShipsNear | undefined): string | null {
  if (!data || data.vessels.length > 0) return null;
  const unavailable = data.sources.filter((s) => s.state === "unreachable" || s.state === "unconfigured");
  return unavailable.length > 0 ? unavailable.map((s) => `${s.name}: ${s.error ?? "not reachable"}`).join("; ") : null;
}
