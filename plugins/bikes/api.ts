import { distanceM } from "../../shared/geo";
import { defineSource, diskMemo, fetchJson, json, lat, lon, memo, parseQuery, z } from "../../server/kit";
import { freeVehiclesNear, pricingOf } from "./gbfs.server";
import type { BikeNetwork, BikeStation, BikesNear } from "./types";

const Networks = z.object({
  networks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      company: z.union([z.array(z.string()), z.string()]).nullable().optional(),
      location: z.object({ latitude: z.number(), longitude: z.number(), city: z.string().default("") }),
    }),
  ),
});

const Stations = z.object({
  network: z.object({
    stations: z.array(
      z.object({
        id: z.string(),
        name: z.string().default(""),
        latitude: z.number(),
        longitude: z.number(),
        free_bikes: z.number().nullable().default(0),
        empty_slots: z.number().nullable().optional(),
        timestamp: z.string(),
        extra: z.object({ ebikes: z.number().optional(), renting: z.union([z.number(), z.boolean()]).optional() }).passthrough().optional(),
      }),
    ),
  }),
});

const NETWORK_RADIUS_M = 30_000;

export default defineSource({
  probes: [
    { name: "Bike share · CityBikes", url: "https://api.citybik.es/v2/networks?fields=id" },
    { name: "Scooters · MobilityData GBFS catalogue", url: "https://raw.githubusercontent.com/MobilityData/gbfs/master/README.md" },
  ],
  routes: {
    "GET /near": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const all = await diskMemo("citybikes-networks", 24 * 3_600_000, async () => (await fetchJson("CityBikes", "https://api.citybik.es/v2/networks?fields=id,name,location,company", Networks)).networks, Networks.shape.networks);
      const near = all
        .map((n) => ({ n, d: distanceM({ lat: q.lat, lon: q.lon }, { lat: n.location.latitude, lon: n.location.longitude }) }))
        .filter((x) => x.d < NETWORK_RADIUS_M)
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
        .map(({ n }) => n);
      const networks: BikeNetwork[] = near.map((n) => ({ id: n.id, name: n.name, city: n.location.city, company: Array.isArray(n.company) ? n.company.join(", ") : (n.company ?? null) }));
      const stations: BikeStation[] = (
        await Promise.all(
          near.map((n) =>
            memo(`citybikes:${n.id}`, 60_000, async () => {
              const d = await fetchJson("CityBikes", `https://api.citybik.es/v2/networks/${encodeURIComponent(n.id)}?fields=stations`, Stations);
              return d.network.stations.map((s) => ({
                id: s.id,
                network: n.id,
                name: s.name,
                lat: s.latitude,
                lon: s.longitude,
                bikes: s.free_bikes ?? 0,
                ebikes: s.extra?.ebikes ?? null,
                docks: s.empty_slots ?? null,
                renting: s.extra?.renting === undefined ? true : Boolean(s.extra.renting),
                updated: s.timestamp,
              }));
            }),
          ),
        )
      ).flat();
      return json({ networks, stations } satisfies BikesNear, { maxAge: 60 });
    },

    "GET /free": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, radiusKm: z.coerce.number().min(0.5).max(25).default(5) }));
      return json(await freeVehiclesNear(q.lat, q.lon, q.radiusKm), { maxAge: 30 });
    },

    "GET /pricing": async (req) => {
      const { system } = parseQuery(req, z.object({ system: z.string().min(1).max(120) }));
      return json({ system, plans: await pricingOf(system) }, { maxAge: 600 });
    },
  },
});
