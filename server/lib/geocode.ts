import { z } from "zod";
import type { Place } from "../../shared/location";
import { memo } from "./cache";
import { fetchJson } from "./upstream";

/** Geocoding with Photon (by Komoot, built on OpenStreetMap). Shared by the kernel and any plugin. */

const PhotonFeature = z.object({
  geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  properties: z.object({
    name: z.string().optional(),
    street: z.string().optional(),
    housenumber: z.string().optional(),
    city: z.string().optional(),
    locality: z.string().optional(),
    district: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    countrycode: z.string().optional(),
    osm_value: z.string().optional(),
    type: z.string().optional(),
  }),
});
const PhotonResponse = z.object({ features: z.array(PhotonFeature) });

function toPlace(f: z.infer<typeof PhotonFeature>): Place {
  const p = f.properties;
  const street = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : undefined;
  const name = p.name ?? street ?? p.city ?? p.state ?? "Unnamed place";
  const context = [p.name ? street : undefined, p.city ?? p.district, p.country].filter((v): v is string => Boolean(v) && v !== name).join(", ");
  const [plon, plat] = f.geometry.coordinates;
  const area = [p.locality ?? p.district, p.city ?? p.state].filter((v, i, all): v is string => Boolean(v) && all.indexOf(v) === i).join(", ");
  return { lat: plat, lon: plon, name, context, area: area || name, kind: p.osm_value ?? p.type ?? "place", countryCode: p.countrycode?.toUpperCase() ?? null };
}

/** Places matching a free-text query, biased towards `near` when given. */
export async function geocode(q: string, near?: { lat: number; lon: number }): Promise<Place[]> {
  const url = new URL("https://photon.komoot.io/api/");
  url.searchParams.set("q", q);
  url.searchParams.set("limit", "8");
  url.searchParams.set("lang", "en");
  if (near) {
    url.searchParams.set("lat", String(near.lat));
    url.searchParams.set("lon", String(near.lon));
  }
  const data = await memo(`geocode:${url}`, 3_600_000, () => fetchJson("Photon geocoder", url, PhotonResponse));
  return data.features.map(toPlace);
}

/** The nearest named place to a point. */
export async function reverseGeocode(lat: number, lon: number): Promise<Place | null> {
  const url = `https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&limit=1&lang=en`;
  const data = await memo(`reverse:${lat.toFixed(4)},${lon.toFixed(4)}`, 86_400_000, () => fetchJson("Photon geocoder", url, PhotonResponse));
  const first = data.features[0];
  return first ? toPlace(first) : null;
}
