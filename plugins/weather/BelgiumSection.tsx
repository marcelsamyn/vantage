import { motion } from "motion/react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { useSettings, type Units } from "../../app/core/settings";
import { inBelgium, temp1, useBelgium } from "./client";
import type { Ceilometer, SoilTemps } from "./types";
import "./weather.css";

const W = 300;
const SKY = 96;
const GROUND = SKY + 6;
const ROW = 17;
/** Cloud heights are drawn on a square-root scale so a 300 m fog layer and a 9 km cirrus deck both fit. */
const SKY_TOP_M = 9000;
const skyY = (m: number): number => SKY - SKY * Math.sqrt(Math.min(m, SKY_TOP_M) / SKY_TOP_M);
const SOIL_MAX_C = 25;

/** What is above and below you: the ceilometer's cloud layers over the ground line, the soil's temperature at four depths under it. */
function Column({ sky, soil, units }: { sky: Ceilometer | null; soil: SoilTemps | null; units: Units }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const height = GROUND + 8 + (soil?.depths.length ?? 0) * ROW;
  return (
    <svg className="weather-column" viewBox={`0 0 ${W} ${height}`} role="img" aria-label="Cloud layers above the station and soil temperature below it">
      <defs>
        <linearGradient id="weather-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--ice)" stopOpacity="0" />
          <stop offset="1" stopColor="var(--ice)" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width={W} height={SKY} fill="url(#weather-sky)" />
      {[1000, 3000, 6000].map((m) => (
        <g key={m}>
          <line x1="0" x2={W} y1={skyY(m)} y2={skyY(m)} className="weather-column__grid" />
          <text x={W - 2} y={skyY(m) - 3} textAnchor="end" className="weather-column__label">
            {fmt.distance(m, units)}
          </text>
        </g>
      ))}
      {sky?.layers.map((l, i) => (
        <motion.g key={l.heightM} initial={reduced ? false : { opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", duration: 0.5, bounce: 0, delay: 0.1 + i * 0.07 }}>
          <rect x="6" y={skyY(l.heightM) - 3} width={Math.max(10, (Math.min(l.oktas, 8) / 8) * 150)} height="6" rx="1" className="weather-column__cloud" />
          <text x={Math.max(10, (Math.min(l.oktas, 8) / 8) * 150) + 12} y={skyY(l.heightM) + 3} className="weather-column__label weather-column__label--bright">
            {fmt.distance(l.heightM, units)} · {l.oktas}/8
          </text>
        </motion.g>
      ))}
      {sky?.baseM != null && (
        <g>
          <line x1="0" x2={W} y1={skyY(sky.baseM)} y2={skyY(sky.baseM)} className="weather-column__base" />
          <text x="6" y={skyY(sky.baseM) + 12} className="weather-column__label weather-column__label--base">
            laser hit cloud at {fmt.distance(sky.baseM, units)}
          </text>
        </g>
      )}
      <line x1="0" x2={W} y1={GROUND} y2={GROUND} className="weather-column__ground" />
      {soil?.depths.map((d, i) => {
        const y = GROUND + 8 + i * ROW;
        const w = Math.max(2, (Math.max(0, Math.min(d.c, SOIL_MAX_C)) / SOIL_MAX_C) * 170);
        return (
          <g key={d.cm}>
            <text x="6" y={y + 11} className="weather-column__label">
              {d.cm} cm
            </text>
            <motion.rect
              x="48"
              y={y + 2}
              height={ROW - 6}
              rx="1"
              className="weather-column__soil"
              initial={reduced ? false : { width: 0 }}
              animate={{ width: w }}
              transition={{ type: "spring", duration: 0.6, bounce: 0, delay: 0.25 + i * 0.07 }}
            />
            <text x={48 + w + 6} y={y + 11} className="weather-column__label weather-column__label--bright">
              {temp1(d.c, units)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const where = (name: string, km: number, at: string): string => `${name}, ${km < 1 ? "here" : `${fmt.int(km)} km away`} · ${fmt.clock(Date.parse(at))}`;

/** Place profile section for Belgian points: the RMI ceilometer's sky, the soil under the grass, and how many people reported the weather. */
export default function BelgiumSection({ entity }: ProfilerSectionProps<"place">): ReactElement | null {
  const units = useSettings((s) => s.units);
  const { lat, lon, countryCode } = entity.data;
  // A dropped pin has no country yet, so fall back to where it lies.
  const at = countryCode === "BE" || (countryCode === null && inBelgium({ lat, lon })) ? { lat, lon } : null;
  const { data, error } = useBelgium(at);
  if (!at) return null;
  if (!data) return error ? <section className="weather-be"><h4 className="v-eyebrow">Sky and soil · RMI</h4><p className="weather-be__note">The Royal Meteorological Institute did not answer: {error.message}</p></section> : null;
  const { ceilometer, soil, crowd } = data;
  if (!ceilometer && !soil && !crowd) return null;

  return (
    <motion.section className="weather-be" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.35, bounce: 0 }}>
      <h4 className="v-eyebrow">Sky and soil · RMI</h4>
      {(ceilometer || soil) && <Column sky={ceilometer} soil={soil} units={units} />}
      <dl className="weather-be__facts">
        {ceilometer && (
          <>
            <dt>Cloud</dt>
            <dd>
              {ceilometer.baseM !== null ? `Lowest cloud at ${fmt.distance(ceilometer.baseM, units)}` : ceilometer.layers.length > 0 ? "The laser saw no cloud at its last reading; layers are averaged over ten minutes" : "The laser saw no cloud"}
              <small>Laser ceilometer: {where(ceilometer.station, ceilometer.distanceKm, ceilometer.at)}</small>
            </dd>
          </>
        )}
        {soil && (
          <>
            <dt>Soil</dt>
            <dd>
              {soil.depths.map((d) => `${temp1(d.c, units)} at ${d.cm} cm`).slice(0, 2).join(", ")}
              {soil.airC !== null && <>, air {temp1(soil.airC, units)}</>}
              <small>Weather station: {where(soil.station, soil.distanceKm, soil.at)}</small>
            </dd>
          </>
        )}
        {crowd && (
          <>
            <dt>Reports</dt>
            <dd>
              {crowd.nearby === 0 ? `No one within ${crowd.radiusKm} km reported the weather in ${crowd.hours} hours` : `${fmt.int(crowd.nearby)} people within ${crowd.radiusKm} km reported the weather in ${crowd.hours} hours`}
              <small>
                {fmt.int(crowd.country)} across Belgium
                {crowd.byKind.length > 0 && ` · ${crowd.byKind.slice(0, 4).map((k) => `${k.kind} ${k.count}`).join(", ")}`}
              </small>
            </dd>
          </>
        )}
      </dl>
      {data.unavailable.length > 0 && <p className="weather-be__note">Not read just now: {data.unavailable.map((u) => u.part).join(", ")}. The institute's server is busy at times.</p>}
      <div className="weather-be__source">Royal Meteorological Institute of Belgium open data · CC BY 4.0 · near-real-time, not yet validated</div>
    </motion.section>
  );
}
