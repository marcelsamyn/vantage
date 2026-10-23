export interface AprsWeather {
  temperatureC?: number;
  humidityPct?: number;
  pressureHpa?: number;
  windFromDeg?: number;
  windMps?: number;
  gustMps?: number;
  rainHourMm?: number;
  rainDayMm?: number;
  rainMidnightMm?: number;
}

export interface AprsPacket {
  id: string;
  callsign: string;
  name: string;
  kind: "station" | "object" | "item";
  alive: boolean;
  lat: number | null;
  lon: number | null;
  symbol: string | null;
  receivedAt: number;
  reportedAt: number | null;
  timestamp: string | null;
  raw: string;
  path: string[];
  destination: string;
  comment: string;
  status: string | null;
  altitudeM: number | null;
  courseDeg: number | null;
  speedKt: number | null;
  weather: AprsWeather | null;
  telemetry: { sequence: number; analog: number[]; digital: string } | null;
}

export type AprsEvent = { t: "status"; message: string; live: boolean } | { t: "packet"; packet: AprsPacket };
export interface AprsStation extends AprsPacket {
  trail: [number, number][];
  positionAt: number;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    aprs: AprsStation;
  }
}
