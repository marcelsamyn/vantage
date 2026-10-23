import { motion } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll, usePrefersReducedMotion } from "../../app/core/hooks";
import { Empty, Meter, Scanning, Scramble } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { useSettings } from "../../app/core/settings";
import { activityWords, fetchAsteroids, stormEffects, sunElevation, useReach, useSpaceWx } from "./client";
import { Block, Result } from "./Block";
import { Trace } from "./Trace";
import type { Approach, AuroraPoint, KpInfo, WindInfo, XrayInfo } from "./types";
import "./spacewx.css";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Sky panel: geomagnetic activity, solar wind, flares, the aurora chance where you stand, and asteroids passing close. */
export default function SpacePanel({ observer }: { observer: LatLon }): ReactElement {
  const now = useSpaceWx((s) => s.now);
  const error = useSpaceWx((s) => s.error);
  const aurora = useSpaceWx((s) => s.aurora);

  if (!now) return error ? <Empty title="No space weather" tone="error">{error}</Empty> : <Scanning label="Listening to the Sun" />;

  return (
    <div className="spacewx-panel">
      <Block label="Geomagnetic activity" note="Kp, planetary index">
        <Result section={now.kp}>{(kp) => <KpBlock kp={kp} />}</Result>
      </Block>
      <Block label="Solar wind" note="measured sunward of Earth">
        <Result section={now.wind}>{(wind) => <WindBlock wind={wind} />}</Result>
      </Block>
      <Block label="Solar flares" note="GOES X-ray flux">
        <Result section={now.xray}>{(xray) => <XrayBlock xray={xray} />}</Result>
      </Block>
      <Block label="Aurora where you are" note={aurora ? `model for ${fmt.clock(aurora.forecastAt)}` : undefined}>
        {aurora ? <AuroraBlock aurora={aurora} observer={observer} /> : <Scanning label="Reading the oval" />}
      </Block>
      <Block label="Asteroids passing close" note="next 30 days">
        <Asteroids />
      </Block>
    </div>
  );
}

// ── Kp ────────────────────────────────────────────────────────────

const SLOT_MS = 3 * HOUR;
const BAR_W = 9;
const BAR_GAP = 2.2;
const CHART_H = 64;

function KpBlock({ kp }: { kp: KpInfo }): ReactElement {
  const clock = useNow(60_000);
  const reduced = usePrefersReducedMotion();
  const today = new Date(clock);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const slots = kp.slots.filter((s) => s.at >= start && s.at < start + 3 * DAY);
  const days = [0, 1, 2].map((i) => {
    const inDay = slots.filter((s) => s.at >= start + i * DAY && s.at < start + (i + 1) * DAY);
    const top = inDay.reduce<(typeof inDay)[number] | null>((best, s) => (!best || s.kp > best.kp ? s : best), null);
    return { start: start + i * DAY, top };
  });
  const worstIndex = days.reduce((best, d, i) => ((d.top?.scale ?? 0) > (days[best]?.top?.scale ?? 0) ? i : best), 0);
  const worst = days[worstIndex];
  const x = (i: number): number => i * (BAR_W + BAR_GAP);
  const total = 24 * (BAR_W + BAR_GAP) - BAR_GAP;
  const yKp = (v: number): number => CHART_H - (Math.min(9, v) / 9) * CHART_H;

  const dayName = (ms: number, i: number): string => (i === 0 ? "Today" : new Date(ms).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" }));

  return (
    <div className="spacewx-kp">
      <div className="spacewx-kp__now">
        <span className={`spacewx-kp__value${kp.scale > 0 ? " spacewx-kp__value--storm" : ""}`}>
          <Scramble text={kp.now.toFixed(1)} duration={520} />
        </span>
        <span className="spacewx-kp__words">
          <strong>{activityWords(kp.scale, kp.now)}</strong>
          <span className="spacewx-dim">{kp.scale > 0 ? `G${kp.scale} on NOAA's storm scale` : "Below storm level (G1 starts at Kp 5)"}</span>
        </span>
      </div>

      <svg className="spacewx-kp__chart" viewBox={`0 0 ${total} ${CHART_H + 16}`} role="img" aria-label="Three-day Kp forecast in three-hour blocks">
        <line x1={0} x2={total} y1={yKp(4.67)} y2={yKp(4.67)} className="spacewx-kp__storm" vectorEffect="non-scaling-stroke" />
        {slots.map((s) => {
          const i = Math.round((s.at - start) / SLOT_MS);
          const current = clock >= s.at && clock < s.at + SLOT_MS;
          return (
            <motion.rect
              key={s.at}
              x={x(i)}
              width={BAR_W}
              y={yKp(Math.max(0.35, s.kp))}
              height={CHART_H - yKp(Math.max(0.35, s.kp))}
              rx={1}
              className={`spacewx-kp__bar${s.scale > 0 ? " spacewx-kp__bar--storm" : ""}${s.kind === "predicted" ? " spacewx-kp__bar--forecast" : ""}${current ? " spacewx-kp__bar--now" : ""}`}
              style={{ transformBox: "fill-box", transformOrigin: "bottom" }}
              initial={reduced ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ type: "spring", duration: 0.5, bounce: 0, delay: i * 0.018 }}
            >
              <title>{`${new Date(s.at).toISOString().slice(5, 16).replace("T", " ")} UTC · Kp ${s.kp.toFixed(1)}${s.scale > 0 ? ` · G${s.scale}` : ""}`}</title>
            </motion.rect>
          );
        })}
        {days.map((d, i) => (
          <text key={d.start} x={x(i * 8)} y={CHART_H + 12} className="spacewx-kp__day">
            {dayName(d.start, i)}
            {d.top && d.top.scale > 0 ? ` · G${d.top.scale}` : ""}
          </text>
        ))}
      </svg>

      <p className="spacewx-kp__outlook">
        {worst?.top && worst.top.scale > 0
          ? `${activityWords(worst.top.scale, worst.top.kp)} (G${worst.top.scale}) expected ${worstIndex === 0 ? "today" : worstIndex === 1 ? "tomorrow" : `on ${dayName(worst.start, worstIndex)}`}, peaking at Kp ${worst.top.kp.toFixed(1)}. ${stormEffects(worst.top.scale)}`
          : "No geomagnetic storm in the three-day forecast."}
        <span className="spacewx-dim"> Blocks are UTC; outlined bars are forecasts.</span>
      </p>
    </div>
  );
}

// ── Solar wind ────────────────────────────────────────────────────

/** Distance from Earth to the L1 point where the measuring spacecraft sit, in km. */
const L1_KM = 1_500_000;
const SOURCE_NAMES: Record<string, string> = { SOLAR1: "SOLAR-1", ACE: "ACE", IMAP: "IMAP", DSCOVR: "DSCOVR" };

function WindBlock({ wind }: { wind: WindInfo }): ReactElement {
  const speeds = wind.series.map((s) => s.speed);
  const densities = wind.series.map((s) => s.density);
  const bzs = wind.series.map((s) => s.bz);
  const numeric = (list: (number | null)[]): number[] => list.filter((v): v is number => v !== null);
  const range = (list: (number | null)[], floor: number): { min: number; max: number } => {
    const v = numeric(list);
    return { min: Math.min(floor, ...v), max: Math.max(floor + 1, ...v) };
  };
  const sp = range(speeds, 250);
  const de = range(densities, 0);
  const bzV = numeric(bzs);
  const bzSpan = Math.max(5, ...bzV.map(Math.abs));
  const travelMin = wind.speedKmS ? Math.round(L1_KM / wind.speedKmS / 60) : null;

  return (
    <div className="spacewx-wind">
      <Row label="Speed" value={wind.speedKmS === null ? "–" : fmt.int(wind.speedKmS)} unit="km/s">
        <Trace values={speeds} min={Math.min(sp.min, 250)} max={sp.max} />
      </Row>
      <Row label="Density" value={wind.densityCm3 === null ? "–" : fmt.one(wind.densityCm3)} unit="p/cm³">
        <Trace values={densities} min={de.min} max={de.max} />
      </Row>
      <Row label="Bz" value={wind.bzNt === null ? "–" : fmt.one(wind.bzNt)} unit="nT" hint={wind.bzNt === null ? undefined : wind.bzNt < 0 ? "southward" : "northward"}>
        <Trace values={bzs} min={-bzSpan} max={bzSpan} guides={[0]} />
      </Row>
      <p className="spacewx-note">
        Past three hours, seen by {SOURCE_NAMES[wind.source] ?? wind.source} at the L1 point.
        {travelMin !== null && ` At this speed the wind reaches Earth in about ${travelMin} minutes.`} A Bz that stays southward opens Earth's magnetic field to the wind, which is what drives storms.
      </p>
    </div>
  );
}

function Row({ label, value, unit, hint, children }: { label: string; value: string; unit: string; hint?: string; children: ReactNode }): ReactElement {
  return (
    <div className="spacewx-row">
      <div className="spacewx-row__text">
        <span className="v-eyebrow">{label}</span>
        <span className="spacewx-row__value num">
          {value}
          <span className="spacewx-row__unit">{unit}</span>
        </span>
        {hint && <span className="spacewx-dim">{hint}</span>}
      </div>
      <div className="spacewx-row__chart">{children}</div>
    </div>
  );
}

// ── Flares ────────────────────────────────────────────────────────

const LOG_MIN = -8;
const LOG_MAX = -3;

function XrayBlock({ xray }: { xray: XrayInfo }): ReactElement {
  const clock = useNow(60_000);
  const letter = xray.class.slice(0, 1);
  const strong = letter === "M" || letter === "X";
  return (
    <div className="spacewx-xray">
      <div className="spacewx-xray__now">
        <span className={`spacewx-xray__class${strong ? " spacewx-xray__class--strong" : ""}`}>
          <Scramble text={xray.class} duration={520} />
        </span>
        <span className="spacewx-dim num">{xray.fluxWm2.toExponential(1)} W/m²</span>
      </div>
      <div className="spacewx-xray__chart">
        <Trace values={xray.series.map((s) => Math.log10(s.flux))} min={LOG_MIN} max={LOG_MAX} guides={[-7, -6, -5, -4]} height={60} />
        <div className="spacewx-xray__bands" aria-hidden>
          {["X", "M", "C", "B", "A"].map((b) => (
            <span key={b}>{b}</span>
          ))}
        </div>
      </div>
      <p className="spacewx-note">
        {xray.flare
          ? `Latest flare: ${xray.flare.class}, peaked at ${fmt.clock(xray.flare.peakAt)} (${fmt.ago(xray.flare.peakAt, clock)})${xray.flare.endedAt ? "" : ", still going"}.`
          : "No flare on record in NOAA's latest list."}
      </p>
    </div>
  );
}

// ── Aurora ────────────────────────────────────────────────────────

function auroraWords(chance: number): string {
  if (chance < 5) return "Not expected";
  if (chance < 15) return "Unlikely";
  if (chance < 30) return "Slim chance";
  if (chance < 60) return "Likely";
  return "Very likely";
}

function AuroraBlock({ aurora, observer }: { aurora: AuroraPoint; observer: LatLon }): ReactElement {
  const clock = useNow(60_000);
  const units = useSettings((s) => s.units);
  const reach = useReach(observer, aurora);
  const chance = aurora.chancePct;
  const sun = sunElevation(observer, new Date(clock));
  const dark = sun < -12;
  return (
    <div className="spacewx-aurora">
      <div className="spacewx-aurora__head">
        <span className="spacewx-aurora__value num">
          {chance}
          <span className="spacewx-row__unit">%</span>
        </span>
        <span className="spacewx-aurora__words">
          <strong>{auroraWords(chance)}</strong>
          <span className="spacewx-dim">{dark ? "Dark where you are" : sun < 0 ? "Twilight where you are" : "Daylight where you are"}</span>
        </span>
      </div>
      <Meter value={chance} max={100} tone="mint" ticks />
      <p className="spacewx-note">
        {chance >= 30 && dark
          ? `Worth stepping outside: find a dark spot and look toward the ${observer.lat >= 0 ? "north" : "south"} horizon.`
          : chance >= 30
            ? "The chance is good, but aurora can only be seen after dark."
            : reach.lat === null
              ? "The oval is too weak near your longitude to be seen from anywhere in your hemisphere right now."
              : `Aurora may be visible low on the ${observer.lat >= 0 ? "northern" : "southern"} horizon as far ${observer.lat >= 0 ? "south" : "north"} as ${Math.round(Math.abs(reach.lat))}°${reach.lat >= 0 ? "N" : "S"}${reach.place ? `, near ${reach.place.context || reach.place.name}` : ""}, ${fmt.distance(reach.distanceM ?? 0, units)} from you.`}
      </p>
    </div>
  );
}

// ── Asteroids ─────────────────────────────────────────────────────

function Asteroids(): ReactElement {
  const clock = useNow(60_000);
  const { data, error, loading } = usePoll((signal) => fetchAsteroids(signal), 3_600_000, []);
  if (!data) return error ? <Empty title="No asteroid data" tone="error">{error.message}</Empty> : loading ? <Scanning label="Checking the neighbourhood" /> : <></>;
  const upcoming = data.approaches.filter((a) => a.at > clock);
  const inside = upcoming.filter((a) => a.distLd < 1).length;
  if (upcoming.length === 0) return <p className="spacewx-note">No known asteroid comes within 0.05 au in the next 30 days.</p>;
  return (
    <div className="spacewx-asteroids">
      <ul>
        {upcoming.slice(0, 6).map((a, i) => (
          <motion.li key={a.name} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ type: "spring", duration: 0.35, bounce: 0, delay: i * 0.05 }}>
            <span className="spacewx-ast__name">{a.name}</span>
            <span className="spacewx-ast__ld num">{ld(a)}</span>
            <span className="spacewx-ast__meta num">
              {when(a, clock)} · {size(a)}
            </span>
          </motion.li>
        ))}
      </ul>
      <p className="spacewx-note">
        {upcoming.length} in the next 30 days{inside > 0 ? `, ${inside} closer than the Moon` : ""}. 1 LD is the Moon's distance, 384,400 km. Sizes without a measurement are estimated from brightness.
      </p>
    </div>
  );
}

const ld = (a: Approach): string => `${a.distLd < 10 ? a.distLd.toFixed(1) : fmt.int(a.distLd)} LD`;

function when(a: Approach, clock: number): string {
  if (a.at - clock < 48 * HOUR) return fmt.until(a.at, clock);
  return new Date(a.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function size(a: Approach): string {
  if (!a.sizeM) return "size unknown";
  const round = (m: number): string => (m < 100 ? fmt.int(m) : fmt.int(Math.round(m / 10) * 10));
  return a.sizeM.measured ? `${round(a.sizeM.max)} m` : `${round(a.sizeM.min)}–${round(a.sizeM.max)} m`;
}
