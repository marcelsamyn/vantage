import { defineSource, fetchJson, json, lat, lon, memo, parseQuery, z } from "../../server/kit";
import type { AirQuality, RadarFrames, Weather } from "./types";
import { belgiumWeather } from "./rmi.server";
import { fireSpots, lightningFrames, lightningImage } from "./satellite.server";
import { snowHistory, snowStations } from "./snow.server";
import { loadWarnings, zoneMunicipalities } from "./warnings.server";

/**
 * Weather and air quality from Open-Meteo (open data from national weather services); rain radar from RainViewer;
 * lightning and fire detection from EUMETSAT; Belgian ceilometers, soil and crowd reports from RMI; Alpine snow from SLF.
 */

const num = z.number();
const Forecast = z.object({
  timezone: z.string(),
  current: z.object({
    time: z.string(),
    temperature_2m: num,
    apparent_temperature: num,
    relative_humidity_2m: num,
    precipitation: num,
    weather_code: num,
    cloud_cover: num,
    wind_speed_10m: num,
    wind_direction_10m: num,
    wind_gusts_10m: num,
    pressure_msl: num,
    is_day: num,
    uv_index: num.nullable().default(0),
  }),
  hourly: z.object({ time: z.array(z.string()), temperature_2m: z.array(num), precipitation_probability: z.array(num.nullable()), precipitation: z.array(num), weather_code: z.array(num) }),
  minutely_15: z.object({ time: z.array(z.string()), precipitation: z.array(num.nullable()) }).optional(),
});

const POLLEN = ["alder", "birch", "grass", "mugwort", "olive", "ragweed"] as const;
const Air = z.object({
  current: z.object({
    european_aqi: num.nullable().optional(),
    us_aqi: num.nullable().optional(),
    pm2_5: num.nullable().optional(),
    pm10: num.nullable().optional(),
    nitrogen_dioxide: num.nullable().optional(),
    ozone: num.nullable().optional(),
    alder_pollen: num.nullable().optional(),
    birch_pollen: num.nullable().optional(),
    grass_pollen: num.nullable().optional(),
    mugwort_pollen: num.nullable().optional(),
    olive_pollen: num.nullable().optional(),
    ragweed_pollen: num.nullable().optional(),
  }),
});

const Rainviewer = z.object({ host: z.string(), radar: z.object({ past: z.array(z.object({ time: num, path: z.string() })), nowcast: z.array(z.object({ time: num, path: z.string() })).default([]) }) });

async function airQuality(la: number, lo: number): Promise<AirQuality | null> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${la}&longitude=${lo}&current=european_aqi,us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,${POLLEN.map((p) => `${p}_pollen`).join(",")}`;
  const c = (await fetchJson("Open-Meteo air quality", url, Air)).current;
  const pollen: Record<string, number> = {};
  for (const p of POLLEN) {
    const v = c[`${p}_pollen`];
    if (typeof v === "number") pollen[p] = v;
  }
  return { europeanAqi: c.european_aqi ?? null, usAqi: c.us_aqi ?? null, pm25: c.pm2_5 ?? null, pm10: c.pm10 ?? null, no2: c.nitrogen_dioxide ?? null, ozone: c.ozone ?? null, pollen };
}

export default defineSource({
  probes: [
    { name: "Weather · Open-Meteo", url: "https://api.open-meteo.com/v1/forecast?latitude=0&longitude=0&current=temperature_2m" },
    { name: "Rain radar · RainViewer", url: "https://api.rainviewer.com/public/weather-maps.json" },
    { name: "Official warnings · MeteoAlarm", url: "https://feeds.meteoalarm.org/" },
    { name: "Lightning · EUMETSAT", url: "https://view.eumetsat.int/geoserver/mtg_fd/li_afa/ows?service=WMS&version=1.3.0&request=GetCapabilities" },
    { name: "Snow stations · SLF", url: "https://measurement-api.slf.ch/public/api/imis/stations" },
  ],
  routes: {
    "GET /now": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      // About 5 km cells: weather does not change faster than that across a city.
      const la = Math.round(q.lat * 20) / 20;
      const lo = Math.round(q.lon * 20) / 20;
      const weather = await memo(`weather:${la},${lo}`, 10 * 60_000, async (): Promise<Weather> => {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&timezone=auto&forecast_hours=24&forecast_minutely_15=8` +
          "&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,is_day,uv_index" +
          "&hourly=temperature_2m,precipitation_probability,precipitation,weather_code&minutely_15=precipitation";
        const [f, air] = await Promise.all([fetchJson("Open-Meteo", url, Forecast), airQuality(la, lo).catch(() => null)]);
        const c = f.current;
        return {
          timezone: f.timezone,
          now: {
            time: c.time,
            tempC: c.temperature_2m,
            feelsC: c.apparent_temperature,
            humidity: c.relative_humidity_2m,
            precipMm: c.precipitation,
            code: c.weather_code,
            cloud: c.cloud_cover,
            windKmh: c.wind_speed_10m,
            windDeg: c.wind_direction_10m,
            gustKmh: c.wind_gusts_10m,
            pressureHpa: c.pressure_msl,
            isDay: c.is_day === 1,
            uv: c.uv_index ?? 0,
          },
          hours: f.hourly.time.map((time, i) => ({
            time,
            tempC: f.hourly.temperature_2m[i] ?? 0,
            precipProb: f.hourly.precipitation_probability[i] ?? 0,
            precipMm: f.hourly.precipitation[i] ?? 0,
            code: f.hourly.weather_code[i] ?? 0,
          })),
          nowcast: f.minutely_15 ? f.minutely_15.time.map((time, i) => ({ time, mm: f.minutely_15?.precipitation[i] ?? 0 })) : [],
          air,
        };
      });
      return json(weather, { maxAge: 300 });
    },

    "GET /warnings": async (req) => {
      const q = parseQuery(req, z.object({ lat: lat.optional(), lon: lon.optional() }));
      const here = q.lat !== undefined && q.lon !== undefined ? { lat: q.lat, lon: q.lon } : null;
      return json(await loadWarnings(here), { maxAge: 60 });
    },

    "GET /municipalities": async (req) => {
      const q = parseQuery(req, z.object({ zone: z.string().min(1).max(120) }));
      return json(await zoneMunicipalities(q.zone), { maxAge: 3600 });
    },

    "GET /lightning/frames": async () => json(await lightningFrames(), { maxAge: 60 }),

    "GET /lightning/image": async (req) => {
      const q = parseQuery(req, z.object({ t: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/) }));
      // A published frame never changes, so the browser may keep it for as long as the loop can ask for it.
      return new Response(await lightningImage(q.t), { headers: { "content-type": "image/png", "cache-control": "private, max-age=3600" } });
    },

    "GET /fires": async () => json(await fireSpots(), { maxAge: 120 }),

    "GET /belgium": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      return json(await belgiumWeather({ lat: q.lat, lon: q.lon }), { maxAge: 120 });
    },

    "GET /snow": async () => json(await snowStations(), { maxAge: 120 }),

    "GET /snow/history": async (req) => {
      const q = parseQuery(req, z.object({ code: z.string().regex(/^[A-Z0-9]{2,8}$/) }));
      return json(await snowHistory(q.code), { maxAge: 120 });
    },

    "GET /radar": async () => {
      const frames = await memo("rainviewer", 5 * 60_000, async (): Promise<RadarFrames> => {
        const d = await fetchJson("RainViewer", "https://api.rainviewer.com/public/weather-maps.json", Rainviewer);
        return { host: d.host, frames: [...d.radar.past, ...d.radar.nowcast] };
      });
      return json(frames, { maxAge: 120 });
    },
  },
});
