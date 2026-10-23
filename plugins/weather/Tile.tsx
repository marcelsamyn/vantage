import { Navigation2, TriangleAlert } from "lucide-react";
import { useState, type PointerEvent, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, Readout, Scanning, Tag } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import { aqiBand, describe, fetchWeather, LEVEL_WORDS, temp1, useBelgium, useWarnings, warningsHere, warningWindow } from "./client";
import { WeatherGlyph } from "./Glyph";
import "./weather.css";

/** One line when an official warning covers you: the strongest one, and how many more there are. */
function WarningLine(): ReactElement | null {
  const { data } = useWarnings();
  const now = useNow(60_000);
  const here = data ? warningsHere(data).filter((w) => w.until * 1000 > now) : [];
  const first = here[0];
  if (!first) return null;
  return (
    <button type="button" className={`weather-warning weather-warning--${first.level}`} onClick={() => profile.open({ kind: "warning", id: first.id, data: first })}>
      <TriangleAlert size={14} />
      <span className="weather-warning__text">
        {LEVEL_WORDS[first.level]} {first.hazard.toLowerCase()} warning {warningWindow(first, now)}
      </span>
      {here.length > 1 && <span className="weather-warning__more num">+{here.length - 1}</span>}
    </button>
  );
}

/** Briefing tile: conditions now, the air you breathe, and the next 24 hours. */
export default function WeatherTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const key = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const { data, error } = usePoll((signal) => (here ? fetchWeather(here, signal) : Promise.reject(new Error("no location"))), 10 * 60_000, [key], !here);
  // The hour under the pointer or finger; its numbers show in the caption under the strip.
  const [pick, setPick] = useState<number | null>(null);
  // Holds off outside Belgium, so the RMI feeds are asked about Belgian positions only.
  const belgium = useBelgium(here);
  if (!here) return <Empty title="Location needed">Weather depends on where you are.</Empty>;
  if (error && !data) return <Empty title="Weather unavailable" tone="error">{error.message}</Empty>;
  if (!data) return <Scanning label="Reading the sky" />;

  const n = data.now;
  const d = describe(n.code);
  const aqi = data.air?.europeanAqi ?? null;
  const band = aqi !== null ? aqiBand(aqi) : null;
  const maxT = Math.max(...data.hours.map((h) => h.tempC));
  const minT = Math.min(...data.hours.map((h) => h.tempC));
  const { ceilometer, soil } = belgium.data ?? { ceilometer: null, soil: null };
  const skyAndSoil = [
    ceilometer && (ceilometer.baseM !== null ? `cloud at ${fmt.distance(ceilometer.baseM, units)}` : "no cloud overhead"),
    soil?.depths[0] && `soil ${temp1(soil.depths[0].c, units)} at ${soil.depths[0].cm} cm`,
  ].filter(Boolean);
  const maxRain = Math.max(...data.hours.map((h) => h.precipProb));
  const hourAt = (e: PointerEvent<HTMLDivElement>): number => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(data.hours.length - 1, Math.floor(((e.clientX - r.left) / r.width) * data.hours.length)));
  };
  const picked = pick === null ? undefined : data.hours[pick];
  const highPollen = Object.entries(data.air?.pollen ?? {})
    .filter(([, v]) => v >= 50)
    .map(([k]) => k);

  return (
    <div className="weather-tile">
      <WarningLine />
      <div className="weather-now">
        <div className="weather-temp">
          <span className="weather-glyph">
            <WeatherGlyph condition={d.condition} isDay={n.isDay} size={30} />
          </span>
          <span className="weather-deg num">{fmt.temp(n.tempC, units)}</span>
        </div>
        <div className="weather-cond">{d.text}</div>
        <div className="v-stat__hint">Feels like {fmt.temp(n.feelsC, units)}</div>
      </div>
      <Readout
        rows={[
          [
            "Wind",
            <span key="w" className="weather-wind">
              <Navigation2 size={12} style={{ rotate: `${n.windDeg + 180}deg` }} />
              {fmt.speedKnots(n.windKmh / 1.852, units)} from {compassPoint(n.windDeg)}
            </span>,
          ],
          ["Gusts", fmt.speedKnots(n.gustKmh / 1.852, units)],
          ["Humidity", `${fmt.int(n.humidity)}%`],
          band && aqi !== null && ["Air", <Tag key="a" tone={band.tone}>{`${band.label} · ${fmt.int(aqi)}`}</Tag>],
          highPollen.length > 0 && ["Pollen", `High: ${highPollen.join(", ")}`],
          n.uv >= 3 && ["UV index", fmt.one(n.uv)],
          skyAndSoil.length > 0 && ["Sky · soil", skyAndSoil.join(" · ")],
        ]}
      />
      <div
        className="weather-hours"
        aria-label="Next 24 hours"
        onPointerDown={(e) => setPick(hourAt(e))}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse" || e.buttons > 0) setPick(hourAt(e));
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setPick(null);
        }}
      >
        {data.hours.map((h, i) => {
          const y = maxT === minT ? 0.5 : (h.tempC - minT) / (maxT - minT);
          return (
            <div key={h.time} className="weather-hour" data-picked={i === pick || undefined}>
              <span className="weather-hour__rain" style={{ height: `${h.precipProb}%` }} />
              <span className="weather-hour__temp" style={{ bottom: `${y * 100}%` }} />
              {i % 6 === 0 && <span className="weather-hour__label num">{h.time.slice(11, 13)}h</span>}
            </div>
          );
        })}
      </div>
      {data.hours.length > 0 && (
        <div className="weather-hours__caption num">
          {picked
            ? `${picked.time.slice(11, 16)} · ${fmt.temp(picked.tempC, units)} · ${picked.precipProb}% rain`
            : `Next 24 h · ${fmt.temp(minT, units)} to ${fmt.temp(maxT, units)} · rain chance up to ${maxRain}%`}
        </div>
      )}
    </div>
  );
}
