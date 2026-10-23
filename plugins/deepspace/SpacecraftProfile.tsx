import { Orbit } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { go } from "../../app/core/nav";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings, type Units } from "../../app/core/settings";
import { Button, Empty, ProfilerCard } from "../../app/ui";
import { fetchSpacecraft } from "./client";
import { eclipticLatitudeDeg } from "./scale";
import { bandWords, distanceWords, lightTimeWords, toAu } from "./physics";
import type { DsnLink, SystemBody } from "./types";
import "./deepspace.css";

const dbmLabel = (dbm: number): string => `${String(dbm).replace("-", "−")} dBm`;
const COMPLEX_NAME = { mdscc: "Madrid", gdscc: "Goldstone", cdscc: "Canberra" } as const;

function speed(kmS: number, units: Units): string {
  return units === "imperial" ? `${fmt.int((kmS * 3600) / 1.609344)} mph` : `${fmt.int(kmS * 3600)} km/h`;
}

/** How far the spacecraft has left the flat disc in which the planets orbit; hidden when it is still close to it. */
function planeRow(body: SystemBody): string | null {
  const lat = eclipticLatitudeDeg(body);
  if (Math.abs(lat) < 5) return null;
  return `${Math.abs(lat).toFixed(0)}° ${lat > 0 ? "north" : "south"} of it`;
}

function linkRows(links: DsnLink[]): ([string, string] | false)[] {
  const first = links[0];
  if (!first) return [["Deep Space Network", "Not on air right now"]];
  const top = first.downlinks[0];
  const up = first.uplinks[0];
  return [
    ["Heard by", links.map((l) => `${COMPLEX_NAME[l.complexId]} · ${l.dishIds.map((d) => d.replace(/^([A-Za-z]+)(\d+)$/, "$1 $2")).join(", ")}`).join(" and ")],
    !!top?.rateBps && ["Data rate", fmt.bitsPerSecond(top.rateBps)],
    !!top && ["Band", bandWords(top.band)],
    !!top && top.powerDbm !== null && ["Received power", dbmLabel(top.powerDbm)],
    !!up && ["Uplink", `${up.powerKw ?? "?"} kW · ${up.band} band`],
  ];
}

/** Profiler for one spacecraft: how far, how fast, how old its signal is, and which dish is listening. */
export default function SpacecraftProfile({ entity, onClose }: ProfilerProps<"spacecraft">): ReactElement {
  const ref = entity.data;
  const units = useSettings((s) => s.units);
  const polled = usePoll((signal) => fetchSpacecraft(ref.naifId, signal), 15_000, [ref.naifId]);
  const p = polled.data;
  const body = p?.body ?? null;
  const links = p?.links ?? [];
  const facts = p?.facts ?? [];
  const plane = body ? planeRow(body) : null;
  const complexes = links.map((l) => COMPLEX_NAME[l.complexId]).join(" and ");

  return (
    <ProfilerCard
      band="Spacecraft"
      tone="sodium"
      name={ref.name}
      kicker={links.length > 0 ? `On air via ${complexes}` : "Not on the Deep Space Network right now"}
      loading={polled.loading && !p}
      onClose={onClose}
      rows={[
        body && ["From Earth", distanceWords(body.distEarthKm, units)],
        body && ["From the Sun", `${toAu(body.distSunKm).toFixed(1)} AU`],
        body && ["Speed", speed(body.speedKmS, units)],
        body && ["Signal left", `${lightTimeWords(body.lightSeconds)} ago`],
        plane && ["Planets' plane", plane],
        ...linkRows(links),
      ]}
      fact={facts.length > 0 ? facts.slice(0, 2).join(" ") : undefined}
      actions={
        <Button size="sm" icon={<Orbit size={14} strokeWidth={1.75} />} onClick={() => go("deepspace", { action: "orrery" })}>
          Show on the Solar System
        </Button>
      }
      source="NASA/JPL Deep Space Network Now · JPL Horizons"
    >
      {polled.error && !p && (
        <Empty title="Could not load this spacecraft" tone="error">
          {polled.error.message}
        </Empty>
      )}
      {p && !body && p.bodyNote && <p className="deepspace-fine">{p.bodyNote}</p>}
      {facts.length > 2 && (
        <ul className="deepspace-facts">
          {facts.slice(2).map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
    </ProfilerCard>
  );
}
