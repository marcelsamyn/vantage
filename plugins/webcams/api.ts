import { HttpError, defineSource, json, lat, lon, parseQuery, reverseGeocode, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { loadOrbit } from "./orbit.server";
import { REMOTE, STREET, camerasAround, coveredCities, covering, gather, type Circle } from "./providers.server";
import type { CamerasInView, CamerasNear, OrbitFrames, RandomCity, RemoteCameras, Webcam } from "./types";

const MAX_IN_VIEW = 400;
/** A wall counts as "near you" when the nearest camera is within this distance. */
const COVERAGE_M = 50_000;
/** Cameras this close to one already on the wall show the same junction, so the wall skips them. */
const SAME_SPOT_M = 150;
const WALL_RADIUS_M = 80_000;

function nearestDistance(cameras: readonly Webcam[], p: LatLon): number | null {
  let best: number | null = null;
  for (const camera of cameras) {
    const d = distanceM(p, camera);
    if (best === null || d < best) best = d;
  }
  return best;
}

/** The `limit` cameras nearest `center`, skipping near-duplicates of the same spot while others remain. */
function wallAround(cameras: readonly Webcam[], center: LatLon, limit: number): Webcam[] {
  const ranked = cameras
    .map((c) => ({ c, d: distanceM(center, c) }))
    .filter((x) => x.d <= WALL_RADIUS_M)
    .sort((a, b) => a.d - b.d);
  const picked: Webcam[] = [];
  const skipped: Webcam[] = [];
  for (const { c } of ranked) {
    if (picked.length >= limit) break;
    if (picked.some((p) => distanceM(p, c) < SAME_SPOT_M)) skipped.push(c);
    else picked.push(c);
  }
  return [...picked, ...skipped].slice(0, limit);
}

/** The city a wall is centred on, from the geocoder. A missing name only costs the caption its place. */
async function placeName(p: LatLon): Promise<string | null> {
  const place = await reverseGeocode(p.lat, p.lon).catch(() => null);
  return place ? (place.area.split(", ").at(-1) ?? place.name) : null;
}

export default defineSource({
  probes: [
    { name: "Traffic cameras · TfL", url: "https://api.tfl.gov.uk/Place/Type/JamCam" },
    { name: "Ocean buoy cameras · NOAA NDBC", url: "https://www.ndbc.noaa.gov/buoycams.php" },
    { name: "Space pictures · NASA EPIC", url: "https://epic.gsfc.nasa.gov/api/natural" },
  ],
  routes: {
    "GET /cameras": async (req) => {
      const q = parseQuery(req, z.object({ minLat: lat, minLon: lon, maxLat: lat, maxLon: lon }));
      if (q.maxLat - q.minLat > 6 || q.maxLon - q.minLon > 8) throw new HttpError(400, "too_large", "Zoom in to see traffic cameras");
      // The circle around the view's centre that reaches its corners; directories answer the cameras nearest the centre.
      const centre: LatLon = { lat: (q.minLat + q.maxLat) / 2, lon: (q.minLon + q.maxLon) / 2 };
      const around: Circle = { ...centre, radiusM: distanceM(centre, { lat: q.maxLat, lon: q.maxLon }) };
      const providers = covering(STREET, around);
      const { cameras, failed } = await gather(providers, (p) => camerasAround(p, around));
      const inView = cameras.filter((c) => c.lat >= q.minLat && c.lat <= q.maxLat && c.lon >= q.minLon && c.lon <= q.maxLon);
      return json({ cameras: inView.slice(0, MAX_IN_VIEW), truncated: inView.length > MAX_IN_VIEW, failed, providers: providers.map((p) => p.name) } satisfies CamerasInView);
    },

    "GET /near": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon, limit: z.coerce.number().int().min(1).max(12).default(9) }));
      const point: LatLon = { lat: q.lat, lon: q.lon };
      const around: Circle = { ...point, radiusM: WALL_RADIUS_M };
      const here = await gather(covering(STREET, around), (p) => camerasAround(p, around));
      const closest = nearestDistance(here.cameras, point);
      if (closest !== null && closest <= COVERAGE_M) {
        return json({ center: point, nearestM: Math.round(closest), place: await placeName(point), moved: false, cameras: wallAround(here.cameras, point, q.limit), failed: here.failed } satisfies CamerasNear);
      }

      // Nothing within range: move the wall to the nearest city an operator covers.
      const target = coveredCities()
        .map((c) => ({ ...c, d: distanceM(point, c.city) }))
        .sort((a, b) => a.d - b.d)[0];
      if (!target) throw new HttpError(503, "no_cameras", "No camera operator is configured.");
      const there = await gather([target.provider], (p) => camerasAround(p, { ...target.city, radiusM: WALL_RADIUS_M }));
      return json({ center: { lat: target.city.lat, lon: target.city.lon }, nearestM: Math.round(target.d), place: target.city.name, moved: true, cameras: wallAround(there.cameras, target.city, q.limit), failed: [...here.failed, ...there.failed] } satisfies CamerasNear);
    },

    "GET /random": () => {
      const cities = coveredCities();
      const pick = cities[Math.floor(Math.random() * cities.length)];
      if (!pick) throw new HttpError(503, "no_cameras", "No camera operator is configured.");
      return json({ lat: pick.city.lat, lon: pick.city.lon, name: pick.city.name } satisfies RandomCity);
    },

    "GET /remote": async () => json((await gather(REMOTE, (p) => p.load())) satisfies RemoteCameras),

    "GET /orbit": async () => json((await loadOrbit()) satisfies OrbitFrames),
  },
});
