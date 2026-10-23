import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { fetchShip } from "./client";
import type { ShipDetails } from "./types";
import { navStatusName, shipTypeName } from "./vessel";

const SOURCE = {
  digitraffic: "AIS via Fintraffic Digitraffic Marine (CC 4.0 BY)",
  kystverket: "AIS via the Norwegian Coastal Administration (NLOD)",
  aisstream: "AIS via AIS Stream · aisstream.io",
} as const;

const metres = (m: number, units: "metric" | "imperial"): string => (units === "imperial" ? `${fmt.int(m * 3.28084)} ft` : `${fmt.one(m)} m`);

/** Profiler for one vessel: what it is, where it is going and how it is moving, as it reports itself over AIS. */
export default function ShipProfile({ entity, onClose }: ProfilerProps<"ship">): ReactElement {
  const v = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(15_000);
  const { data, loading, error } = usePoll((signal) => fetchShip(v.mmsi, signal), 15_000, [v.mmsi]);
  const s: ShipDetails | (typeof v & Partial<ShipDetails>) = data ?? v;
  const status = navStatusName(s.navStatus);
  const underway = (s.sogKt ?? 0) >= 0.5;

  return (
    <ProfilerCard
      band={s.reportKind === "sar-aircraft" ? "Search-and-rescue aircraft" : "Vessel"}
      tone="sodium"
      name={s.name ?? `MMSI ${s.mmsi}`}
      kicker={[s.reportKind === "sar-aircraft" ? "AIS search-and-rescue report" : shipTypeName(s.shipType), s.flag].filter(Boolean).join(" · ")}
      loading={loading && !data}
      onClose={onClose}
      rows={[
        s.flag && ["Flag", s.flag],
        s.altitudeM !== undefined && s.altitudeM !== null && ["Altitude", metres(s.altitudeM, units)],
        s.destination && ["Destination", s.destination],
        s.etaMs && ["Arrival", `${new Date(s.etaMs).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · ${fmt.until(s.etaMs, now)}`],
        s.sogKt !== null && ["Speed", underway ? fmt.speedKnots(s.sogKt, units) : "Not moving"],
        s.cogDeg !== null && underway && ["Course", `${String(Math.round(s.cogDeg)).padStart(3, "0")}° ${compassPoint(s.cogDeg)}`],
        s.headingDeg !== null && ["Heading", `${String(Math.round(s.headingDeg)).padStart(3, "0")}°`],
        status && ["Status", status],
        data?.lengthM && data.beamM && ["Size", `${metres(data.lengthM, units)} long, ${metres(data.beamM, units)} wide`],
        data?.draughtM && ["Draught", metres(data.draughtM, units)],
        data?.imo && ["IMO number", String(data.imo)],
        data?.callSign && ["Call sign", data.callSign],
        ["MMSI", String(s.mmsi)],
        here && ["From you", `${fmt.distance(distanceM(here, s), units)} ${compassPoint(bearingDeg(here, s))}`],
        ["Last report", fmt.ago(s.at, now)],
        ...(s.safetyReports ?? []).map((r): [string, string] => [r.recipientMmsi ? `Safety to MMSI ${r.recipientMmsi}` : "Safety broadcast", `${r.text} · ${fmt.ago(r.at, now)}`]),
      ]}
      fact={
        error && !data
          ? error.message
          : s.reportKind === "sar-aircraft"
            ? "This aircraft broadcasts a search-and-rescue AIS position report. The report does not say whether a rescue is in progress."
            : underway
            ? "Ships under way send their position every two to ten seconds; at anchor or in port, every three minutes. Any radio receiver near the coast can pick it up."
            : "While moored or at anchor a vessel reports every three minutes, so its position on the map can be up to that old."
      }
      source={SOURCE[s.source]}
    />
  );
}
