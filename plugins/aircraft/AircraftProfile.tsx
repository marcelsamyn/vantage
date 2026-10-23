import { Crosshair, ExternalLink } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { go } from "../../app/core/nav";
import type { ProfilerProps } from "../../app/core/plugin";
import { profile } from "../../app/core/profile";
import { useSettings, type Units } from "../../app/core/settings";
import { Button, ProfilerCard, Readout, Scramble, Tag, type MaybeRow } from "../../app/ui";
import { compassPoint, lookAngle } from "../../shared/geo";
import { fetchDetails, fetchNear, projected, useCircling, usePhoto, useTraffic } from "./client";
import { emergencyOf } from "./emergency";
import { useFollow } from "./follow";
import { companyLink, flightLink, registrationLink, trackerLink, typeLink } from "./links";
import { categoryName, modelName, squawkMeaning } from "./models";
import { PhotoHeader } from "./Photo";
import type { Aircraft, AircraftDetails, Airport } from "./types";
import "./aircraft.css";

/** Profiler for one aircraft: a photo, who owns and flies it, where it is going, and where it is relative to you. */
export default function AircraftProfile({ entity, onClose }: ProfilerProps<"aircraft">): ReactElement {
  const snapshot = entity.data;
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const now = useNow(1000);
  const follow = useFollow((s) => s.hex === snapshot.hex);

  // Keep the profile live. Aircraft near you come from the watcher's data; others are looked up
  // around their last known position.
  const watchedA = useTraffic((s) => s.snapshot?.aircraft.find((x) => x.hex === snapshot.hex) ?? null);
  const watchedAt = useTraffic((s) => s.snapshot?.fetchedAt ?? 0);
  const watched = watchedA ? { a: watchedA, fetchedAt: watchedAt } : null;
  const polled = usePoll(
    async (signal) => {
      const near = await fetchNear(projected(snapshot, snapshot.fetchedAt, Date.now()), 25, signal);
      const a = near.aircraft.find((x) => x.hex === snapshot.hex);
      return a ? { a, fetchedAt: near.fetchedAt } : null;
    },
    10_000,
    [snapshot.hex],
    watched !== null,
  );
  const live = { data: watched ?? polled.data };
  const details = usePoll((signal) => fetchDetails(snapshot, signal), null, [snapshot.hex, snapshot.callsign]);
  const { photo, error: photoError } = usePhoto(snapshot.hex);

  const a: Aircraft = live.data?.a ?? snapshot;
  const fetchedAt = live.data?.fetchedAt ?? snapshot.fetchedAt;
  const pos = projected(a, fetchedAt, now);
  const d: AircraftDetails | undefined = details.data;
  const lost = live.data === null;

  const emergency = emergencyOf(a);
  const circling = useCircling((st) => st.byHex.get(snapshot.hex)?.loiter ?? null);
  const look = here && a.altFt !== null ? lookAngle(here, { ...pos, altM: a.altFt * 0.3048 }) : null;
  const registration = a.registration ?? d?.registration ?? null;
  const typeCode = a.typeCode ?? d?.typeCode ?? null;
  const friendly = typeCode && modelName(typeCode) !== typeCode ? modelName(typeCode) : null;
  const model = friendly ?? ([d?.manufacturer, d?.model].filter(Boolean).join(" ") || a.typeName || typeCode);
  const owner = d?.owner ?? a.ownerOperator;
  // The receiver network's database follows the registry more closely than adsbdb, so the two can name different owners.
  const listedOwner = d?.owner && a.ownerOperator && !sameName(a.ownerOperator, d.owner) ? a.ownerOperator : null;
  const airline = d?.airline ?? null;
  const operator = airline && !sameName(airline.name, owner) ? airline : null;
  const ownerCode = d?.ownerAirlineCode ?? (airline && !operator ? airline.icao : null);
  const name = a.callsign ?? registration ?? a.hex.toUpperCase();

  const identity: MaybeRow[] = [
    a.callsign && ["Callsign", <Id href={flightLink(a.callsign)} text={a.callsign} extra={[d?.flightIata !== a.callsign && d?.flightIata, airline?.radioCallsign && `says “${airline.radioCallsign}”`]} />],
    registration && ["Registration", <Id href={registrationLink(registration, a.hex)} text={registration} extra={[d?.ownerCountry]} />],
    model && ["Type", <Id href={typeLink(typeCode)} text={model} extra={[typeCode !== model && typeCode, a.year && `built ${a.year}`]} />],
    owner && ["Owner", <Id href={companyLink(owner, ownerCode)} text={owner} />],
    listedOwner && ["Owner or operator", <Id href={companyLink(listedOwner, null)} text={listedOwner} />],
    operator && ["Operator", <Id href={companyLink(operator.name, operator.icao)} text={operator.name} extra={[operator.country]} />],
    [
      "Transponder",
      <Id
        href={trackerLink(a.hex)}
        text={a.hex.toUpperCase()}
        extra={[a.positionSource, a.military && "military", a.notable && "notable", a.privacyProgramme && `in ${a.privacyProgramme}`, lost && "signal lost"]}
      />,
    ],
  ];

  const speeds = airspeed(a);
  const climb = vertical(a);
  const selected = autopilot(a);
  const flight: MaybeRow[] = [
    d?.origin && d.destination && [
      "Route",
      <>
        <AirportLink airport={d.origin} /> → <AirportLink airport={d.destination} />
      </>,
    ],
    (a.onGround || a.altFt !== null) && ["Altitude", a.onGround ? "On the ground" : fmt.altitude(a.altFt ?? 0, units)],
    a.speedKt !== null && ["Ground speed", `${fmt.speedKnots(a.speedKt, units)} · ${fmt.int(a.speedKt)} kt`],
    speeds && ["Airspeed", speeds],
    a.trackDeg !== null && ["Heading", `${degrees(a.trackDeg)} ${compassPoint(a.trackDeg)}`],
    climb && ["Vertical", climb],
    selected && ["Autopilot", selected],
    a.windKt !== null && a.windFromDeg !== null && ["Wind", `${fmt.speedKnots(a.windKt, units)} from ${degrees(a.windFromDeg)} ${compassPoint(a.windFromDeg)}`],
    a.outsideAirC !== null && ["Outside air", fmt.temp(a.outsideAirC, units)],
    a.squawk && ["Squawk", `${a.squawk}${squawkMeaning(a.squawk) ? ` · ${squawkMeaning(a.squawk)}` : ""}`],
    look && ["From you", fromYou(look, units)],
  ];

  return (
    <ProfilerCard
      band={emergency ? "Aircraft · emergency" : "Aircraft profile"}
      tone={emergency ? "alarm" : "sodium"}
      name={name}
      kicker={[airline?.name ?? owner, model ?? categoryName(a.category)].filter(Boolean).join(" · ") || "Aircraft"}
      loading={details.loading && !d}
      onClose={onClose}
      rows={[]}
      fact={fact(a, look?.el ?? null, d)}
      actions={
        <>
          <Button
            size="sm"
            on={follow}
            icon={<Crosshair size={13} />}
            onClick={() => {
              useFollow.getState().set(follow ? null : a.hex);
              if (!follow) go("city");
            }}
          >
            {follow ? "Following" : "Follow on map"}
          </Button>
          <a className="v-btn v-btn--sm v-btn--ghost" href={`https://globe.adsb.lol/?icao=${a.hex}`} target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> adsb.lol
          </a>
        </>
      }
      source="ADS-B via adsb.lol (ODbL) · owner, airframe and route via adsbdb.com"
    >
      {photo && <PhotoHeader photo={photo} alt={[registration ?? name, model].filter(Boolean).join(", ")} />}
      {photoError && <p className="aircraft-note">No photo: {photoError.message}</p>}
      <Rows rows={identity} />
      <Rows rows={flight} />
      {details.error && <p className="aircraft-note">Owner and route unavailable: {details.error.message}</p>}
      {(emergency || circling) && (
        <div className="aircraft-badges">
          {emergency && (
            <div className="aircraft-badge aircraft-badge--alarm">
              <Tag tone="alarm">
                {emergency.code} · {emergency.title}
              </Tag>
              <p>
                {emergency.meaning} {emergency.next}
              </p>
            </div>
          )}
          {circling && (
            <div className="aircraft-badge">
              <Tag tone="sodium">Circling · {circling.minutes} min</Tag>
              <p>
                It has turned {fmt.int(circling.turnDeg)}° {circling.direction} within a circle {fmt.distance(Math.max(circling.radiusM * 2, 1), units)} wide. News, police, survey, medical and training flights fly like this.
              </p>
            </div>
          )}
        </div>
      )}
    </ProfilerCard>
  );
}

function Rows({ rows }: { rows: MaybeRow[] }): ReactElement | null {
  if (!rows.some(Boolean)) return null;
  return <Readout className="aircraft-rows" rows={rows.map((r, i) => r && ([r[0], typeof r[1] === "string" ? <Scramble text={r[1]} duration={380} delay={200 + i * 45} /> : r[1]] as const))} />;
}

/** An identifier, linked to a page about it when one exists, followed by quieter facts about it. */
function Id({ href, text, extra = [] }: { href: string | null; text: string; extra?: (string | null | false | undefined)[] }): ReactElement {
  const rest = extra.filter((x): x is string => Boolean(x));
  return (
    <>
      {href ? (
        <a className="aircraft-id" href={href} target="_blank" rel="noreferrer noopener">
          {text}
        </a>
      ) : (
        text
      )}
      {rest.length > 0 && <span className="aircraft-id__extra"> · {rest.join(" · ")}</span>}
    </>
  );
}

/** An airport opens its own place profile, with the area around it. */
function AirportLink({ airport }: { airport: Airport }): ReactElement {
  const label = [airport.iata ?? airport.icao, airport.city].filter(Boolean).join(" ") || airport.name;
  const open = (): void =>
    profile.open({
      kind: "place",
      id: `${airport.lat.toFixed(5)},${airport.lon.toFixed(5)}`,
      data: { lat: airport.lat, lon: airport.lon, name: airport.name, context: [airport.city, airport.country].filter(Boolean).join(", "), area: airport.city ?? "", kind: "aerodrome", countryCode: airport.countryCode },
    });
  return (
    <button type="button" className="aircraft-id" onClick={open} title={`Open the profile of ${airport.name}`}>
      {label}
    </button>
  );
}

/** "easyJet" and "easyJet Airline", or "American Airlines" and "AMERICAN AIRLINES INC", are one name. */
function sameName(x: string, y: string | null): boolean {
  if (y === null) return false;
  const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const [a, b] = [norm(x), norm(y)];
  // A name in another script (Japanese, Cyrillic) normalises to nothing, which would match everything.
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

const degrees = (deg: number): string => `${String(Math.round(deg) % 360).padStart(3, "0")}°`;

function airspeed(a: Aircraft): string | null {
  const parts = [a.iasKt !== null && `${fmt.int(a.iasKt)} kt indicated`, a.tasKt !== null && `${fmt.int(a.tasKt)} kt true`, a.mach !== null && `Mach ${a.mach.toFixed(2)}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function vertical(a: Aircraft): string | null {
  if (a.vertRateFpm === null) return null;
  return Math.abs(a.vertRateFpm) < 250 ? "Level" : `${a.vertRateFpm > 0 ? "Climbing" : "Descending"} ${fmt.int(Math.abs(a.vertRateFpm))} ft/min`;
}

const MODES: Record<string, string> = { autopilot: "autopilot", vnav: "VNAV", althold: "altitude hold", approach: "approach", lnav: "LNAV", tcas: "TCAS" };

/** What the crew dialled in: target altitude and heading, and the modes the autopilot reports. */
function autopilot(a: Aircraft): string | null {
  const parts = [
    a.selectedAltFt !== null && `to ${a.selectedAltFt >= 18_000 ? `FL${Math.round(a.selectedAltFt / 100)}` : `${fmt.int(a.selectedAltFt)} ft`}`,
    a.selectedHeadingDeg !== null && `heading ${degrees(a.selectedHeadingDeg)}`,
    a.autopilotModes.length > 0 && a.autopilotModes.map((m) => MODES[m] ?? m).join(", "),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

function fromYou(look: { rangeM: number; az: number; el: number }, units: Units): string {
  return `${fmt.distance(look.rangeM, units)} ${compassPoint(look.az)} · ${look.el > 0 ? `${Math.round(look.el)}° up` : "below horizon"}`;
}

function fact(a: Aircraft, elevationDeg: number | null, d: AircraftDetails | undefined): ReactNode {
  if (a.onGround) return "On the ground, the transponder keeps reporting its position so controllers can see it taxi.";
  if (a.vertRateFpm !== null && a.vertRateFpm < -700 && d?.destination) return `Descending at ${fmt.int(-a.vertRateFpm)} ft/min, most likely on its approach to ${d.destination.name}.`;
  if (a.vertRateFpm !== null && a.vertRateFpm > 1200) return `Climbing ${fmt.int(a.vertRateFpm * 0.00508)} m every second.`;
  if (a.altFt !== null && a.altFt > 25_000 && a.outsideAirC !== null) return `At ${fmt.int(a.altFt)} ft the air outside the cabin is ${fmt.int(a.outsideAirC)} °C.`;
  if (elevationDeg !== null && elevationDeg > 20) return `Look up: it is ${Math.round(elevationDeg)}° above your horizon right now.`;
  return "Its transponder broadcasts this position about twice a second.";
}
