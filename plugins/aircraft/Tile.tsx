import type { ReactElement, ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { useMotionNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, LiveDot, Scanning, Stat } from "../../app/ui";
import { bearingDeg, distanceM } from "../../shared/geo";
import { AROUND_NM, projected, useEmergencies, usePhoto, useTraffic } from "./client";
import { emergencyOf } from "./emergency";
import { modelName } from "./models";
import { PhotoThumb, credit } from "./Photo";
import type { Aircraft } from "./types";
import "./aircraft.css";

const SIZE = 168;

/** Briefing tile: a small scope of the traffic around you and the nearest flight. */
export default function AircraftTile(): ReactElement {
  const snapshot = useTraffic((s) => s.snapshot);
  const error = useTraffic((s) => s.error);
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  // Traffic moves between polls: every second while someone watches, every 15 s at rest.
  const now = useMotionNow(1000, 15_000);

  if (!snapshot || !here) return error ? <Empty title="No aircraft feed" tone="error">{error}</Empty> : <Scanning label="Listening for transponders" />;

  const rangeM = AROUND_NM * 1852;
  const planes = snapshot.aircraft
    .map((a) => {
      const p = projected(a, snapshot.fetchedAt, now);
      return { a, p, d: distanceM(here, p), b: bearingDeg(here, p) };
    })
    .filter((x) => x.d <= rangeM)
    .sort((x, y) => x.d - y.d);
  const nearest = planes[0];

  return (
    <div>
      <div className="aircraft-tile">
        {/* The sweep turns on its own HTML layer: the compositor rotates it, where a rotating SVG group would repaint the scope every frame. */}
        <div className="aircraft-scope">
          <span className="aircraft-scope__sweep" aria-hidden />
          <svg className="aircraft-scope__plot" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} aria-label={`${planes.length} aircraft within ${AROUND_NM} nautical miles`}>
            {[1, 0.66, 0.33].map((r) => (
              <circle key={r} cx={SIZE / 2} cy={SIZE / 2} r={(SIZE / 2 - 2) * r} className="aircraft-scope__ring" />
            ))}
            <line x1={SIZE / 2} y1={2} x2={SIZE / 2} y2={SIZE - 2} className="aircraft-scope__ring" />
            <line x1={2} y1={SIZE / 2} x2={SIZE - 2} y2={SIZE / 2} className="aircraft-scope__ring" />
            {planes.map(({ a, d, b }) => {
              const r = (d / rangeM) * (SIZE / 2 - 6);
              const x = SIZE / 2 + r * Math.sin((b * Math.PI) / 180);
              const y = SIZE / 2 - r * Math.cos((b * Math.PI) / 180);
              return (
                <g
                  key={a.hex}
                  transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.trackDeg ?? 0})`}
                  className={a === nearest?.a ? "aircraft-scope__blip aircraft-scope__blip--near" : "aircraft-scope__blip"}
                  onClick={() => profile.open({ kind: "aircraft", id: a.hex, data: { ...a, fetchedAt: snapshot.fetchedAt } })}
                >
                  <title>{a.callsign ?? a.hex}</title>
                  <path d="M0,-4.5 L3,3.5 L0,2 L-3,3.5 Z" />
                </g>
              );
            })}
            <circle cx={SIZE / 2} cy={SIZE / 2} r={2.5} className="aircraft-scope__you" />
          </svg>
        </div>
        <div className="aircraft-tile__stats">
          <Stat label={`Within ${AROUND_NM} nm`} value={planes.length} unit="aircraft" tone="sodium" />
          {nearest && (
            <AircraftRow
              a={nearest.a}
              fetchedAt={snapshot.fetchedAt}
              label={
                <>
                  <span className="v-eyebrow">Nearest</span>
                  <span className="aircraft-tile__call">{nameOf(nearest.a)}</span>
                </>
              }
              detail={`${fmt.distance(nearest.d, units)} · ${nearest.a.onGround ? "on the ground" : nearest.a.altFt !== null ? `${fmt.int(nearest.a.altFt)} ft` : "altitude unknown"}`}
            />
          )}
        </div>
      </div>
      <EmergencyLine />
    </div>
  );
}

/** One line on the state of emergencies worldwide, including the quiet case. */
function EmergencyLine(): ReactElement | null {
  const snapshot = useEmergencies((s) => s.snapshot);
  const error = useEmergencies((s) => s.error);
  if (!snapshot) return error ? <p className="aircraft-tile__alerts">Emergency list unavailable: {error}</p> : null;
  const squawking = snapshot.aircraft.filter((a) => emergencyOf(a));
  if (squawking.length === 0) {
    return (
      <p className="aircraft-tile__alerts">
        <LiveDot tone="mint" />
        No aircraft are squawking an emergency anywhere in the world.
      </p>
    );
  }
  return (
    <div className="aircraft-tile__squawks">
      <p className="aircraft-tile__alerts">
        <LiveDot tone="alarm" />
        {squawking.length} {squawking.length === 1 ? "aircraft is" : "aircraft are"} squawking an emergency{squawking.length > 3 ? "; the first three:" : ":"}
      </p>
      <ul>
        {squawking.slice(0, 3).map((a) => {
          const emergency = emergencyOf(a);
          return (
            <li key={a.hex}>
              <AircraftRow
                a={a}
                fetchedAt={snapshot.fetchedAt}
                label={
                  <span className="aircraft-row__name">
                    {nameOf(a)} · {emergency?.code} {emergency?.title.toLowerCase()}
                  </span>
                }
                detail={[a.registration !== nameOf(a) && a.registration, a.typeCode && modelName(a.typeCode), a.ownerOperator].filter(Boolean).join(" · ") || "No airframe data"}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const nameOf = (a: Aircraft): string => a.callsign ?? a.registration ?? a.hex.toUpperCase();

/** One aircraft in a list: its photo when a source has one, with the credit, then what it is. The text opens its profile. */
function AircraftRow({ a, fetchedAt, label, detail }: { a: Aircraft; fetchedAt: number; label: ReactNode; detail: string }): ReactElement {
  const { photo } = usePhoto(a.hex);
  return (
    <div className="aircraft-row">
      {photo && <PhotoThumb photo={photo} alt={[a.registration ?? nameOf(a), a.typeCode && modelName(a.typeCode)].filter(Boolean).join(", ")} />}
      <button type="button" className="aircraft-row__open" onClick={() => profile.open({ kind: "aircraft", id: a.hex, data: { ...a, fetchedAt } })}>
        {label}
        <span className="v-stat__hint">{detail}</span>
        {photo && <span className="aircraft-row__credit">{credit(photo)}</span>}
      </button>
    </div>
  );
}
