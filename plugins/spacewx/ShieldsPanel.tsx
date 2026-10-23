import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { go } from "../../app/core/nav";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, LiveDot, Scanning, Scramble } from "../../app/ui";
import { distanceM, type LatLon } from "../../shared/geo";
import { Block, Result } from "./Block";
import { fetchShields } from "./client";
import { dayTicks, hourTicks, ShieldsChart } from "./ShieldsChart";
import { SkyMirror } from "./SkyMirror";
import { roundKm, shieldsStatus, topOpenBand } from "./status";
import type { CosmicRays, FieldInfo, FieldLevel, IonosphereInfo, RayStation } from "./types";
import "./spacewx.css";

const HOUR = 3_600_000;

const signed = (n: number, digits = 1): string => `${n < 0 ? "−" : n > 0 ? "+" : ""}${Math.abs(n).toFixed(digits)}`;

/** Sky panel: the three layers that stand between the Sun and the ground, each with a live chart. */
export default function ShieldsPanel({ observer }: { observer: LatLon }): ReactElement {
  const units = useSettings((s) => s.units);
  const key = `${observer.lat.toFixed(1)},${observer.lon.toFixed(1)}`;
  const { data, error } = usePoll((signal) => fetchShields(observer, signal), 10 * 60_000, [key]);

  if (!data) return error ? <Empty title="No data on Earth's shields" tone="error">{error.message}</Empty> : <Scanning label="Reading Earth's shields" />;

  const status = shieldsStatus(
    { cosmic: data.cosmic.ok ? data.cosmic.data : null, field: data.field.ok ? data.field.data : null, sky: data.sky.ok ? data.sky.data : null },
    (km) => fmt.distance(km * 1000, units),
  );

  return (
    <div className="spacewx-panel">
      {status && (
        <p className={`spacewx-sh-status spacewx-sh-status--${status.tone}`}>
          <LiveDot tone={status.tone === "quiet" ? "mint" : status.tone === "unsettled" ? "sodium" : "alarm"} />
          <span>{status.line}</span>
        </p>
      )}
      <Block label="Cosmic rays" note="neutron monitors · 7 days">
        <Result section={data.cosmic}>{(cosmic) => <CosmicBlock cosmic={cosmic} observer={observer} />}</Result>
      </Block>
      <Block label="Magnetic field" note="INTERMAGNET · 24 h">
        <Result section={data.field}>{(field) => <FieldBlock field={field} />}</Result>
      </Block>
      <Block label="Radio mirror" note="ionosphere · now">
        <Result section={data.sky}>{(sky) => <SkyBlock sky={sky} />}</Result>
      </Block>
      <p className="spacewx-sh-credits">
        {data.cosmic.ok ? `${data.cosmic.data.acknowledgement} ` : ""}
        Magnetic field: INTERMAGNET observatories, served by the British Geological Survey, under CC BY-NC 4.0. Ionosphere: GIRO ionosondes, relayed by prop.kc2g.com. Data is raw, not an official alert.
      </p>
    </div>
  );
}

// ── Cosmic rays ───────────────────────────────────────────────────

function CosmicBlock({ cosmic, observer }: { cosmic: CosmicRays; observer: LatLon }): ReactElement {
  const clock = useNow(60_000);
  const [first, second] = [...cosmic.stations].sort((a, b) => distanceM(observer, a) - distanceM(observer, b)) as [RayStation, RayStation | undefined];
  const fall = cosmic.forbush;
  const values = cosmic.stations.flatMap((s) => s.points.map((p) => p.pct));
  const lo = Math.min(-3, Math.floor(Math.min(...values)));
  const hi = Math.max(3, Math.ceil(Math.max(...values)));
  const from = Math.min(...cosmic.stations.map((s) => s.points[0]?.at ?? Infinity));
  const to = Math.max(...cosmic.stations.map((s) => s.latest.at)) + HOUR;
  const down = fall?.ongoing === true;
  const deepest = fall ? (cosmic.stations.find((s) => s.code === fall.code)?.name ?? "") : "";

  return (
    <div className="spacewx-sh">
      <div className="spacewx-sh__head">
        <span className={`spacewx-sh__value${down ? " spacewx-sh__value--alarm" : ""}`}>
          <Scramble text={`${signed(down && fall ? -fall.depthPct : first.latest.pct)} %`} duration={520} />
        </span>
        <span className="spacewx-sh__words">
          <strong>{down ? `Forbush decrease, ${deepest} at its low` : "Normal"}</strong>
          <span className="spacewx-dim">
            <span className="spacewx-sh__key spacewx-sh__key--sodium" />
            {first.name} {down ? `${signed(first.latest.pct)} %` : "now"}
            {second && (
              <>
                {" · "}
                <span className="spacewx-sh__key spacewx-sh__key--fog" />
                {second.name} {signed(second.latest.pct)} %
              </>
            )}
          </span>
        </span>
      </div>
      <ShieldsChart
        series={[
          { points: first.points.map((p) => ({ at: p.at, v: p.pct })), tone: down ? "alarm" : "sodium", gapMs: 3 * HOUR },
          ...(second ? [{ points: second.points.map((p) => ({ at: p.at, v: p.pct })), tone: "fog" as const, gapMs: 3 * HOUR }] : []),
        ]}
        from={from}
        to={to}
        min={lo}
        max={hi}
        ticks={dayTicks(from, to)}
        guides={[{ v: 0, label: "" }]}
        bands={fall ? [{ from: fall.onsetAt, to: fall.untilAt + HOUR, label: `Forbush decrease · ${deepest} −${fall.depthPct.toFixed(0)} %` }] : []}
        ariaLabel={`Cosmic ray counts at ${cosmic.stations.map((s) => s.name).join(" and ")} over seven days, as percent from the median`}
      />
      <p className="spacewx-note">
        Cosmic rays are atoms from deep space. A solar storm cloud sweeps them away from Earth, so counts fall at once: a Forbush decrease.{" "}
        {fall
          ? `${deepest} fell ${fall.depthPct.toFixed(1)} % from ${fmt.clock(fall.onsetAt)}, ${fmt.ago(fall.onsetAt, clock)}${down ? ", and the counts have not recovered yet" : ", and has since recovered"}.`
          : "Both monitors sit within a few percent of their weekly median, which is normal. The dashed line is the weekly median. Hourly counts, updated each hour."}
      </p>
    </div>
  );
}

// ── Magnetic field ────────────────────────────────────────────────

const LEVEL_WORDS: Record<FieldLevel, string> = { calm: "Calm", unsettled: "Unsettled", active: "Active", storm: "Storm" };

function FieldBlock({ field }: { field: FieldInfo }): ReactElement {
  const units = useSettings((s) => s.units);
  const clock = useNow(60_000);
  const swing = Math.max(30, Math.ceil(Math.max(...field.series.map((p) => Math.abs(p.dNt))) / 10) * 10);
  const from = field.series[0]?.at ?? field.at - 24 * HOUR;
  const to = field.at + 5 * 60_000;
  const hot = field.level === "storm" || field.level === "active";

  return (
    <div className="spacewx-sh">
      <div className="spacewx-sh__head">
        <span className={`spacewx-sh__value${hot ? " spacewx-sh__value--alarm" : ""}`}>
          <Scramble text={`${Math.round(field.range3hNt)}`} duration={520} />
          <span className="spacewx-row__unit">nT</span>
        </span>
        <span className="spacewx-sh__words">
          <strong>{LEVEL_WORDS[field.level]}</strong>
          <span className="spacewx-dim">
            3-hour swing · {field.name}, {fmt.distance(field.distanceKm * 1000, units)} away
          </span>
        </span>
      </div>
      <ShieldsChart
        series={[{ points: field.series.map((p) => ({ at: p.at, v: p.dNt })), tone: hot ? "alarm" : "sodium", gapMs: 30 * 60_000 }]}
        from={from}
        to={to}
        min={-swing}
        max={swing}
        ticks={hourTicks(from, to, 6)}
        guides={[{ v: 0, label: "" }]}
        ariaLabel={`Change of the horizontal magnetic field at ${field.name} over 24 hours, nanotesla`}
      />
      <p className="spacewx-note">
        Earth's magnetic field holds off the solar wind. When a storm hits, its horizontal part swings by hundreds of nanotesla within hours. A quiet day moves it by up to about 35 nT, just from sunrise and sunset. The dashed line is the day's median. Latest minute {fmt.ago(field.at, clock)}.
        {field.skipped.length > 0 && ` Nearer ${field.skipped.join(" and ")} sent no data in the last three hours.`}
      </p>
    </div>
  );
}

// ── Ionosphere ────────────────────────────────────────────────────

function SkyBlock({ sky }: { sky: IonosphereInfo }): ReactElement {
  const units = useSettings((s) => s.units);
  const { main, other } = sky;
  const best = topOpenBand(sky.bands);
  const number = (km: number): string => roundKm(units === "imperial" ? km * 0.621371 : km).toLocaleString("en-US");
  const unit = units === "imperial" ? "mi" : "km";

  return (
    <div className="spacewx-sh">
      <div className="spacewx-sh__head">
        <span className="spacewx-sh__value">
          <Scramble text={best?.name ?? "–"} duration={520} />
        </span>
        <span className="spacewx-sh__words">
          <strong>{best ? `${best.name} is the highest open band` : "No band bounces"}</strong>
          {best && <span className="spacewx-dim">{best.state === "near" ? "Bounces from straight overhead" : `Signals land from ${number(best.fromKm)} ${unit} out`}</span>}
          <span className="spacewx-dim num">
            {main.name} sounding at {fmt.clock(main.at)} · foF2 {fmt.one(main.foF2)} MHz · MUF {fmt.one(main.muf3000)} MHz
          </span>
        </span>
      </div>
      <SkyMirror info={sky} />
      <ul className="spacewx-bands" aria-label="Shortwave bands">
        {sky.bands.map((b) => (
          <li key={b.name} className={`spacewx-bands__item spacewx-bands__item--${b.state}`} title={`${b.name} (${b.mhz} MHz): ${b.state === "closed" ? "passes through the layer" : b.state === "near" ? "bounces from straight overhead" : `first lands ${number(b.fromKm)} ${unit} away`}`}>
            <span className="spacewx-bands__name">{b.name}</span>
            <span className="spacewx-bands__km num">{b.state === "closed" ? "–" : b.state === "near" ? "0" : number(b.fromKm)}</span>
          </li>
        ))}
      </ul>
      <p className="spacewx-note">
        A sheet of charged air {Math.round(main.hmF2)} km up reflects shortwave radio. The higher the frequency, the further out the signal lands; above the layer's limit it escapes to space. Numbers show where each band first lands ({unit}).
        {other && ` For comparison, ${other.name} reads foF2 ${fmt.one(other.foF2)} MHz at ${fmt.clock(other.at)}.`} By day the lowest bands also fade in the D layer, which this does not model.
      </p>
      {best && (
        <Button size="sm" onClick={() => go("reach", { action: "tune" })}>
          Tune a radio on an open band
        </Button>
      )}
    </div>
  );
}
