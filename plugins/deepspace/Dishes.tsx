import { motion } from "motion/react";
import * as SunCalc from "suncalc";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { LiveDot, Panel, Tag } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { DishArt, type DishState } from "./DishArt";
import { COMPLEX_PLACE, openSpacecraft } from "./client";
import { bandWords, powerWords } from "./physics";
import type { DsnComplex, DsnDish, DsnSignal, DsnSnapshot, SpacecraftRef } from "./types";

const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const dbmLabel = (dbm: number): string => `${String(dbm).replace("-", "−")} dBm`;

function stateOf(dish: DsnDish): DishState {
  if (dish.onAir) return "live";
  return dish.targets.length > 0 ? "pointed" : "idle";
}

/** Distinct spacecraft a dish is on, from its signals when it has any and from its targets otherwise. */
function craftOf(dish: DsnDish): SpacecraftRef[] {
  const source = dish.onAir ? dish.signals.filter((s) => s.active).map((s) => s.spacecraft) : dish.targets.map((t) => t.spacecraft);
  return source.filter((c, i) => source.findIndex((o) => o.naifId === c.naifId) === i);
}

function Craft({ craft }: { craft: SpacecraftRef }): ReactElement {
  return (
    <button type="button" className="deepspace-craft" onClick={() => openSpacecraft(craft)}>
      {craft.name}
    </button>
  );
}

function SignalRow({ signal }: { signal: DsnSignal }): ReactElement {
  const down = signal.direction === "down";
  return (
    <li className="deepspace-sig">
      <span className={`deepspace-sig__dir deepspace-sig__dir--${signal.direction}`} aria-label={down ? "Downlink" : "Uplink"}>
        {down ? "↓" : "↑"}
      </span>
      <span className="deepspace-sig__band" title={bandWords(signal.band)}>
        {signal.band} band
      </span>
      <span className="deepspace-sig__rate num">{signal.rateBps ? fmt.bitsPerSecond(signal.rateBps) : signal.type === "carrier" ? "carrier only" : "rate not reported"}</span>
      <span className="deepspace-sig__power num">{down ? (signal.powerDbm !== null ? dbmLabel(signal.powerDbm) : "") : signal.powerKw !== null ? `${signal.powerKw} kW` : ""}</span>
    </li>
  );
}

function DishCard({ dish, index }: { dish: DsnDish; index: number }): ReactElement {
  const state = stateOf(dish);
  const active = dish.signals.filter((s) => s.active);
  const down = active.filter((s) => s.direction === "down");
  const up = active.filter((s) => s.direction === "up");
  const loudest = down.find((s) => s.powerDbm !== null);
  const crafts = craftOf(dish);

  return (
    <motion.article
      layout="position"
      className={`deepspace-dish deepspace-dish--${state}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.5, bounce: 0, delay: Math.min(index, 8) * 0.05 }}
    >
      <DishArt name={dish.name} sizeM={dish.sizeM} azimuthDeg={dish.azimuthDeg} elevationDeg={dish.elevationDeg} state={state} downlink={down.length > 0} uplink={up.length > 0} delayMs={index * 70} />
      <div className="deepspace-dish__body">
        <header className="deepspace-dish__head">
          <span className="deepspace-dish__name num">{dish.name}</span>
          <Tag>{dish.sizeM} m</Tag>
          {dish.array && <Tag tone="sodium">Array</Tag>}
        </header>
        {crafts.length > 0 ? (
          <div className="deepspace-dish__who">
            {crafts.map((c) => (
              <Craft key={c.naifId} craft={c} />
            ))}
          </div>
        ) : (
          <div className="deepspace-dish__rest">{sentence(dish.activity) || "At rest"}</div>
        )}
        <div className="deepspace-dish__pose num">
          <span>
            <span className="v-eyebrow">Az</span> {String(Math.round(dish.azimuthDeg)).padStart(3, "0")}°
          </span>
          <span>
            <span className="v-eyebrow">El</span> {String(Math.round(dish.elevationDeg)).padStart(2, "0")}°
          </span>
        </div>
        {state === "live" && (
          <>
            <ul className="deepspace-sigs">
              {[...down, ...up].map((s, i) => (
                <SignalRow key={i} signal={s} />
              ))}
            </ul>
            {loudest && loudest.powerDbm !== null && <p className="deepspace-dish__words">Arrives at {powerWords(loudest.powerDbm)}.</p>}
          </>
        )}
        {state === "pointed" && <p className="deepspace-dish__words">Pointed at it, with no signal locked yet.</p>}
      </div>
    </motion.article>
  );
}

/** A dish with nothing to do: small, quiet, and still in its real pose. */
function RestDish({ dish, index }: { dish: DsnDish; index: number }): ReactElement {
  return (
    <motion.article layout="position" className="deepspace-resting" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + index * 0.05 }}>
      <DishArt name={dish.name} sizeM={dish.sizeM} azimuthDeg={dish.azimuthDeg} elevationDeg={dish.elevationDeg} state="idle" downlink={false} uplink={false} delayMs={400 + index * 70} />
      <div className="deepspace-resting__text">
        <span className="deepspace-dish__name num">
          {dish.name} <span className="deepspace-resting__size">{dish.sizeM} m</span>
        </span>
        <span className="deepspace-dish__rest">{sentence(dish.activity) || "At rest"}</span>
      </div>
    </motion.article>
  );
}

function localClock(now: number, offsetMin: number): string {
  return new Date(now + offsetMin * 60_000).toISOString().slice(11, 16);
}

function daylight(now: number, c: DsnComplex): string {
  const alt = SunCalc.getPosition(new Date(now), c.latitude, c.longitude).altitude * (180 / Math.PI);
  return alt > 0 ? "Day" : alt > -6 ? "Twilight" : "Night";
}

/** Ticks on its own, so the second hand does not re-render every dish card of the panel. */
function ComplexClock({ complex }: { complex: DsnComplex }): ReactElement {
  const now = useNow(1000);
  return (
    <div className="deepspace-complex__clock num" aria-label={`Local time at ${complex.name}`}>
      <span className="deepspace-complex__time">{localClock(now, complex.utcOffsetMin)}</span>
      <span className="deepspace-complex__sun">{daylight(now, complex)} there</span>
    </div>
  );
}

function ComplexPanel({ complex, lead }: { complex: DsnComplex; lead: boolean }): ReactElement {
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const place = COMPLEX_PLACE[complex.id];
  const onAir = complex.dishes.filter((d) => d.onAir).length;
  // Busy dishes first, then the ones that are only pointed, then the ones at rest; stable within each group.
  const rank = (d: DsnDish): number => (d.onAir ? 0 : d.targets.length > 0 ? 1 : 2);
  const dishes = [...complex.dishes].sort((a, b) => rank(a) - rank(b));
  const site = { lat: complex.latitude, lon: complex.longitude };
  const fromYou = here ? { m: distanceM(here, site), bearing: bearingDeg(here, site) } : null;

  return (
    <Panel active={lead} className={`deepspace-complex${lead ? " deepspace-complex--lead" : ""}`}>
      <header className="deepspace-complex__head">
        <div className="deepspace-complex__titles">
          <div className="v-eyebrow">
            <LiveDot tone={onAir > 0 ? "sodium" : "ice"} live={onAir > 0} /> {onAir} of {complex.dishes.length} dishes on air
          </div>
          <h2 className="deepspace-complex__name display">{complex.name}</h2>
          <p className="deepspace-complex__place">
            {place.place}, {place.country}
            {lead && fromYou && <span className="deepspace-complex__near"> · {fmt.distance(fromYou.m, units)} {compassPoint(fromYou.bearing)} of you</span>}
          </p>
        </div>
        <ComplexClock complex={complex} />
      </header>
      <div className="deepspace-dishes">
        {dishes.filter((d) => rank(d) < 2).map((d, i) => (
          <DishCard key={d.id} dish={d} index={i} />
        ))}
      </div>
      {dishes.some((d) => rank(d) === 2) && (
        <div className="deepspace-rest">
          {dishes.filter((d) => rank(d) === 2).map((d, i) => (
            <RestDish key={d.id} dish={d} index={i} />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** The hero: every dish of the three complexes, in real pose, with the signals running along their line of sight. */
export function Dishes({ dsn }: { dsn: DsnSnapshot }): ReactElement {
  const lead = dsn.complexes.find((c) => c.id === "mdscc");
  const rest = dsn.complexes.filter((c) => c !== lead);
  return (
    <div className="deepspace-complexes">
      {lead && <ComplexPanel complex={lead} lead />}
      {rest.length > 0 && (
        <div className="deepspace-complexes__rest">
          {rest.map((c) => (
            <ComplexPanel key={c.id} complex={c} lead={false} />
          ))}
        </div>
      )}
    </div>
  );
}
