import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard, Readout, type MaybeRow } from "../../app/ui";
import { useAprsStations } from "./client";
import "./aprs.css";

export default function AprsProfile({ entity, onClose }: ProfilerProps<"aprs">): ReactElement {
  const live = useAprsStations((s) => s.stations.get(entity.id));
  const p = live ?? entity.data;
  const now = useNow(1000);
  const units = useSettings((s) => s.units);
  const weather = p.weather;
  const rain = (mm: number): string => units === "imperial" ? `${fmt.one(mm / 25.4)} in` : `${fmt.one(mm)} mm`;
  const rows: MaybeRow[] = [
    ["Callsign", <a href={`https://aprs.fi/?call=${encodeURIComponent(p.callsign)}`} target="_blank" rel="noreferrer">{p.callsign}</a>],
    p.kind !== "station" && ["Report", `${p.kind} · reported by ${p.callsign}`],
    ["Last heard", `${Math.max(0, Math.floor((now - p.receivedAt) / 1000))} s ago · ${new Date(p.receivedAt).toISOString()}`],
    ["Position received", new Date(p.positionAt).toISOString()],
    p.reportedAt !== null && ["Packet time", new Date(p.reportedAt).toISOString()],
    p.timestamp !== null && p.reportedAt === null && ["Packet time", `${p.timestamp} · local time or unsupported timestamp`],
    p.lat !== null && p.lon !== null && ["Position", `${p.lat}, ${p.lon}`],
    p.symbol && ["APRS symbol", p.symbol],
    p.altitudeM !== null && ["Altitude", units === "imperial" ? `${fmt.one(p.altitudeM / 0.3048)} ft` : `${fmt.one(p.altitudeM)} m`],
    p.speedKt !== null && ["Speed", fmt.speedKnots(p.speedKt, units)],
    p.courseDeg !== null && ["Course", `${p.courseDeg}°`],
    weather?.temperatureC !== undefined && ["Temperature", fmt.temp(weather.temperatureC, units)],
    weather?.humidityPct !== undefined && ["Humidity", `${weather.humidityPct}%`],
    weather?.pressureHpa !== undefined && ["Pressure", `${weather.pressureHpa} hPa`],
    weather?.windMps !== undefined && ["Wind", `${fmt.speedKnots(weather.windMps / 0.514444, units)}${weather.windFromDeg === undefined ? "" : ` from ${weather.windFromDeg}°`}`],
    weather?.gustMps !== undefined && ["Wind gust", fmt.speedKnots(weather.gustMps / 0.514444, units)],
    weather?.rainHourMm !== undefined && ["Rain · hour", rain(weather.rainHourMm)],
    weather?.rainDayMm !== undefined && ["Rain · 24 hours", rain(weather.rainDayMm)],
    weather?.rainMidnightMm !== undefined && ["Rain · since midnight", rain(weather.rainMidnightMm)],
    p.telemetry !== null && ["Telemetry", `#${p.telemetry.sequence} · ${p.telemetry.analog.join(", ")} · bits ${p.telemetry.digital}`],
    p.status && ["Status", p.status],
    p.comment && ["Comment", p.comment],
    ["Destination", p.destination],
    p.path.length > 0 && ["Packet path", p.path.join(" → ")],
  ];
  return <ProfilerCard band="APRS radio" name={p.name} kicker={live ? "Latest received report" : "Saved report · station no longer in this stream"} tone="sodium" onClose={onClose} rows={[]} source="APRS-IS · amateur radio packet reports">
    <Readout className="aprs-rows" rows={rows} />
    <details className="aprs-raw"><summary>Raw packet</summary><pre>{p.raw}</pre></details>
  </ProfilerCard>;
}
