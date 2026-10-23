import { distanceM } from "../../shared/geo";
import { defineSource, fetchJson, json, lat, lon, memo, parseQuery, reverseGeocode, z } from "../../server/kit";
import { overpass, type OsmElement } from "../grid/overpass.server";
import { articlesNear, summary } from "../places/wiki.server";
import type { Article, Route, Structure, TravelMode, WhatsHere } from "./types";

// ── What's here ───────────────────────────────────────────────────

const Elevation = z.object({ elevation: z.array(z.number()) });

async function elevation(la: number, lo: number): Promise<number | null> {
  const d = await fetchJson("Open-Meteo elevation", `https://api.open-meteo.com/v1/elevation?latitude=${la}&longitude=${lo}`, Elevation);
  return d.elevation[0] ?? null;
}

const num = (v: string | undefined): number | null => {
  const n = v ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

function toStructure(el: OsmElement): Structure {
  const t = el.tags;
  const levels = num(t["building:levels"]);
  return {
    name: t["name:en"] ?? t.name ?? null,
    kind: [t.building !== "yes" ? t.building : null, t.amenity, t.tourism, t.historic].find((v): v is string => Boolean(v))?.replace(/_/g, " ") ?? "building",
    levels,
    heightM: num(t.height) ?? (levels ? levels * 3.2 : null),
    built: t.start_date ?? t["building:start_date"] ?? null,
    architect: t.architect ?? null,
    operator: t.operator ?? null,
    website: t.website ?? t["contact:website"] ?? null,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

async function structureAt(la: number, lo: number): Promise<Structure | null> {
  const els = await overpass(`is_in(${la},${lo})->.a;(way(pivot.a)[building];relation(pivot.a)[building];way(pivot.a)[tourism];way(pivot.a)[historic];);out tags center 6;`, 15);
  // Prefer a named building, then any building.
  const pick = els.find((e) => e.tags.building && e.tags.name) ?? els.find((e) => e.tags.building) ?? els.find((e) => e.tags.name);
  return pick ? toStructure(pick) : null;
}

/** The Wikipedia article for this spot: one whose title matches the place name, else the nearest. */
async function articleNear(la: number, lo: number, placeName: string | null): Promise<Article | null> {
  const pins = await articlesNear(la, lo, 150, 8);
  const ranked = pins.map((p) => ({ p, d: distanceM({ lat: la, lon: lo }, p) })).sort((a, b) => a.d - b.d);
  const wanted = placeName?.toLowerCase();
  const pick = (wanted && ranked.find(({ p }) => p.title.toLowerCase().includes(wanted) || wanted.includes(p.title.toLowerCase()))) || ranked[0];
  if (!pick) return null;
  const s = await summary(pick.p.title);
  return { title: s.title, extract: s.extract, thumbnail: s.thumbnail, url: s.url, distanceM: Math.round(pick.d) };
}

const settle = async <T>(p: Promise<T>): Promise<T | null> => p.catch(() => null);

// ── Routing (OSRM: project-osrm.org for driving, openstreetmap.de for walking and cycling) ──

const ROUTERS: Record<TravelMode, string> = {
  car: "https://router.project-osrm.org/route/v1/driving",
  foot: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
  bike: "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
};

const Osrm = z.object({
  code: z.string(),
  routes: z.array(z.object({ distance: z.number(), duration: z.number(), geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])) }) })).default([]),
});

export default defineSource({
  // MapLibre renders tiles in a web worker that must load from its own URL.
  assets: { maplibre: "node_modules/maplibre-gl/dist" },
  probes: [
    { name: "Elevation · Open-Meteo", url: "https://api.open-meteo.com/v1/elevation?latitude=0&longitude=0" },
    { name: "Routing · OSRM", url: "https://router.project-osrm.org/route/v1/driving/13.388860,52.517037;13.397634,52.529407?overview=false" },
  ],
  routes: {
    "GET /whatshere": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const key = `${q.lat.toFixed(5)},${q.lon.toFixed(5)}`;
      const result = await memo(`whatshere:${key}`, 3_600_000, async () => {
        const placeTask = settle(reverseGeocode(q.lat, q.lon));
        const [place, elevationM, article] = await Promise.all([placeTask, settle(elevation(q.lat, q.lon)), placeTask.then((p) => settle(articleNear(q.lat, q.lon, p?.name ?? null)))]);
        return { lat: q.lat, lon: q.lon, place, elevationM, article } satisfies WhatsHere;
      });
      return json(result, { maxAge: 3600 });
    },

    // Separate from /whatshere because Overpass often takes several seconds.
    "GET /structure": async (req) => {
      const q = parseQuery(req, z.object({ lat, lon }));
      const structure = await memo(`structure:${q.lat.toFixed(5)},${q.lon.toFixed(5)}`, 86_400_000, () => structureAt(q.lat, q.lon));
      return json(structure satisfies Structure | null, { maxAge: 86_400 });
    },

    "GET /route": async (req) => {
      const q = parseQuery(req, z.object({ fromLat: lat, fromLon: lon, toLat: lat, toLon: lon, mode: z.enum(["foot", "bike", "car"]) }));
      const url = `${ROUTERS[q.mode]}/${q.fromLon},${q.fromLat};${q.toLon},${q.toLat}?overview=full&geometries=geojson`;
      const d = await memo(`route:${url}`, 600_000, () => fetchJson("OSRM router", url, Osrm));
      const r = d.routes[0];
      if (!r) return json({ error: { code: "no_route", message: `No ${q.mode} route between these points` } }, { status: 404 });
      return json({ mode: q.mode, distanceM: r.distance, durationS: r.duration, line: r.geometry.coordinates } satisfies Route);
    },
  },
});
