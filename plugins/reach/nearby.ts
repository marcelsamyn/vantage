import { MessageSquareText, Radio, SatelliteDish, Wrench } from "lucide-react";
import type { NearbyItem, NearbyProvider } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import { destination, distanceM, type LatLon } from "../../shared/geo";
import { fetchNotes, fetchOrders, fetchReceivers, fetchStations, formatBand, noteIsOpen, receiverIsFree } from "./client";
import { seatsText, type GroundStation, type MapNote, type Receiver, type WorkOrder } from "./types";

const MAX = 3;

const within = <T extends LatLon>(items: readonly T[], at: LatLon, radiusM: number): T[] =>
  items
    .map((item) => ({ item, d: distanceM(at, item) }))
    .filter((x) => x.d <= radiusM)
    .sort((a, b) => a.d - b.d)
    .map((x) => x.item);

/** One line of free text for a row: line breaks become spaces, and a long text is cut. */
const oneLine = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Receivers with a free seat, nearest first. */
export function receiverItems(receivers: readonly Receiver[], at: LatLon, radiusM: number): NearbyItem[] {
  return within(receivers.filter(receiverIsFree), at, radiusM)
    .slice(0, MAX)
    .map((r): NearbyItem => {
      const entity = { kind: "receiver", id: r.id, data: r } as const;
      return {
        id: r.id,
        title: r.name,
        detail: [r.place, formatBand(r.minHz, r.maxHz), seatsText(r)].filter(Boolean).join(" · "),
        kind: "do",
        at: { lat: r.lat, lon: r.lon },
        icon: Radio,
        tone: "sodium",
        entity,
        primary: { label: "Tune in", run: () => import("./store").then((m) => m.tuneIn(r)) },
        more: [{ label: "Show receiver", run: () => profile.open(entity) }],
      };
    });
}

/** Open notes, nearest first. A note closed in the past week is not something to act on. */
export function noteItems(notes: readonly MapNote[], at: LatLon, radiusM: number): NearbyItem[] {
  return within(notes.filter(noteIsOpen), at, radiusM)
    .slice(0, MAX)
    .map((n): NearbyItem => {
      const entity = { kind: "mapnote", id: String(n.id), data: n } as const;
      return {
        id: String(n.id),
        title: `Map note ${n.id}`,
        detail: oneLine(n.comments[0]?.text ?? "", 90) || "Open note without text",
        kind: "do",
        at: { lat: n.lat, lon: n.lon },
        icon: MessageSquareText,
        tone: "fog",
        entity,
        primary: { label: "Read note", run: () => profile.open(entity) },
        more: [{ label: "On OpenStreetMap", href: n.url }],
      };
    });
}

/** Ground stations, nearest first; one that records a pass now is live until the pass ends. */
export function stationItems(stations: readonly GroundStation[], at: LatLon, radiusM: number): NearbyItem[] {
  return within(
    stations.filter((s) => s.status === "online"),
    at,
    radiusM,
  )
    .slice(0, MAX)
    .map((s): NearbyItem => {
      const entity = { kind: "groundstation", id: String(s.id), data: s } as const;
      return {
        id: String(s.id),
        title: s.name,
        detail: s.observing ? `Recording ${s.observing.satellite}` : [s.antennas.join(" + ") || "Satellite ground station", `${s.observations.toLocaleString("en-US")} passes recorded`].join(" · "),
        kind: "see",
        at: { lat: s.lat, lon: s.lon },
        icon: SatelliteDish,
        tone: s.observing ? "sodium" : "mint",
        ...(s.observing ? { live: true, until: s.observing.endsAt } : {}),
        entity,
        primary: { label: "Show station", run: () => profile.open(entity) },
      };
    });
}

/** Open reports to the city, nearest first. */
export function orderItems(orders: readonly WorkOrder[], at: LatLon, radiusM: number): NearbyItem[] {
  return within(orders, at, radiusM)
    .slice(0, MAX + 2)
    .map((o): NearbyItem => {
      const entity = { kind: "workorder", id: o.id, data: o } as const;
      return {
        id: `${o.operator}:${o.id}`,
        title: o.category,
        detail: [o.status === "acknowledged" ? "Acknowledged" : "Open", o.authority ?? o.operator, o.description && oneLine(o.description, 80)].filter(Boolean).join(" · "),
        kind: "see",
        at: { lat: o.lat, lon: o.lon },
        icon: Wrench,
        tone: "fog",
        ...(o.photo ? { image: o.photo } : {}),
        entity,
        primary: { label: "Show report", run: () => profile.open(entity) },
        more: [{ label: "Open report", href: o.url }],
      };
    });
}

/** The box around you that holds the radius, which is what the notes route takes. */
export function boxAround(at: LatLon, radiusM: number): { west: number; south: number; east: number; north: number } {
  return {
    north: destination(at, 0, radiusM).lat,
    south: destination(at, 180, radiusM).lat,
    east: destination(at, 90, radiusM).lon,
    west: destination(at, 270, radiusM).lon,
  };
}

/** The receiver list is the map layer's own, which the server keeps for ten minutes. */
export const receiverNearby: NearbyProvider = async ({ at, radiusM }, signal) => receiverItems((await fetchReceivers(signal)).receivers, at, radiusM);

export const noteNearby: NearbyProvider = async ({ at, radiusM }, signal) => noteItems((await fetchNotes(boxAround(at, radiusM), signal)).notes, at, radiusM);

export const stationNearby: NearbyProvider = async ({ at, radiusM }, signal) => stationItems((await fetchStations(signal)).stations, at, radiusM);

/**
 * An empty list from a city that no reporting service covers is not an error. The server searches around a 0.01° grid
 * point, up to 700 m from you, so the request reaches a kilometre past the radius and the list keeps to it.
 */
export const orderNearby: NearbyProvider = async ({ at, radiusM }, signal) => orderItems((await fetchOrders(at, Math.min(25, radiusM / 1000 + 1), signal)).orders, at, radiusM);
