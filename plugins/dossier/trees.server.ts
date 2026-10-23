import { HttpError, diskMemo, fetchJson, memo, webUrl, z } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import type { MapTree, TreeRecord, TreeTile, Trees } from "./types";

/**
 * Street-tree registers of Brussels, Ghent, Paris and Bologna, all published as Opendatasoft datasets.
 * Brussels and Paris also publish a list of remarkable trees. Every query is built from numbers only.
 */

const DAY_MS = 24 * 3_600_000;

const StoredTreeTile = z.object({
  sources: z.array(z.string()),
  trees: z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lon: z.number(), remarkable: z.boolean() })),
  truncated: z.boolean(),
});

type TreeBase = Omit<TreeRecord, "distanceM">;

interface Dataset {
  city: CityId;
  /** Shown to the user, e.g. "City of Brussels · Remarkable trees". */
  source: string;
  records: string;
  exports: string;
  geoField: string;
  /** Field to sort by to find the thickest tree, when the dataset has a measured girth. */
  girthField: string | null;
  remarkable: boolean;
  select: string;
  parse: (rows: unknown) => TreeBase[];
}

type CityId = "brussels" | "ghent" | "paris" | "bologna";

interface City {
  id: CityId;
  box: { south: number; north: number; west: number; east: number };
}

const CITIES: City[] = [
  { id: "brussels", box: { south: 50.76, north: 50.92, west: 4.24, east: 4.5 } },
  { id: "ghent", box: { south: 51.0, north: 51.12, west: 3.62, east: 3.85 } },
  { id: "paris", box: { south: 48.8, north: 48.92, west: 2.2, east: 2.5 } },
  { id: "bologna", box: { south: 44.42, north: 44.58, west: 11.2, east: 11.45 } },
];

const Point = z.object({ lat: z.number(), lon: z.number() });
const yearOf = (date: string | null | undefined): number | null => {
  const y = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;
  return Number.isFinite(y) && y > 1000 ? y : null;
};
/** Registers write 0 for "not measured". */
const measured = (n: number | null | undefined): number | null => (n && n > 0 ? n : null);

// ── Brussels ────────────────────────────────────────────────────

const BrusselsRemarkable = z.array(
  z.object({
    id_arbres_cms: z.string(),
    nom_fr: z.string().nullish(),
    nom_la: z.string().nullish(),
    circonference: z.number().nullish(),
    diametre_cime: z.number().nullish(),
    url_fr: z.string().nullish(),
    geo_point_2d: Point,
  }),
);

const BrusselsTrees = z.array(
  z.object({
    id: z.string(),
    species: z.string().nullish(),
    address_fr: z.string().nullish(),
    geo_point_2d: Point,
  }),
);

const BRUSSELS = "https://opendata.brussels.be/api/explore/v2.1/catalog/datasets";

// ── Ghent ───────────────────────────────────────────────────────

const GhentTrees = z.array(
  z.object({
    gis_id: z.string(),
    sortiment: z.string().nullish(),
    hoogte: z.string().nullish(),
    stamomtrek: z.number().nullish(),
    aanlegjaar: z.string().nullish(),
    straatnaam: z.string().nullish(),
    geo_point_2d: Point,
  }),
);

// ── Paris ───────────────────────────────────────────────────────

const ParisTrees = z.array(
  z.object({
    idbase: z.number(),
    libellefrancais: z.string().nullish(),
    genre: z.string().nullish(),
    espece: z.string().nullish(),
    circonferenceencm: z.number().nullish(),
    hauteurenm: z.number().nullish(),
    adresse: z.string().nullish(),
    geo_point_2d: Point,
  }),
);

const ParisRemarkable = z.array(
  z.object({
    arbres_idbase: z.number(),
    arbres_libellefrancais: z.string().nullish(),
    arbres_genre: z.string().nullish(),
    arbres_espece: z.string().nullish(),
    arbres_circonferenceencm: z.number().nullish(),
    arbres_hauteurenm: z.number().nullish(),
    arbres_dateplantation: z.string().nullish(),
    arbres_adresse: z.string().nullish(),
    com_url_pdf: z.string().nullish(),
    geom_x_y: Point,
  }),
);

// ── Bologna ─────────────────────────────────────────────────────

const BolognaTrees = z.array(
  z.object({
    num_pt: z.string(),
    classe: z.string().nullish(),
    cl_h: z.string().nullish(),
    classe_circonferenza_diametro: z.string().nullish(),
    pregio: z.string().nullish(),
    data_impnt: z.string().nullish(),
    geo_point_2d: Point,
  }),
);

/** "Cl5: >23mt" becomes ">23 m" and "Cl4: 16mt - 23mt" becomes "16-23 m". */
const bolognaHeight = (label: string | null | undefined): string | null => {
  const m = /:\s*(.+)$/.exec(label ?? "");
  const range = m?.[1]?.replace(/\s*mt\b/gi, "").replace(/\s*-\s*/g, "-").trim();
  return range ? `${range} m` : null;
};
/** "Cl9: 170 - 200 (54-64 cm)" becomes "170-200 cm": the first range is the circumference. */
const bolognaGirth = (label: string | null | undefined): string | null => {
  const m = /:\s*([\d.]+)\s*-\s*([\d.]+)/.exec(label ?? "");
  return m ? `${m[1]}-${m[2]} cm` : null;
};

const base = (over: Partial<TreeBase> & Pick<TreeBase, "id" | "species" | "lat" | "lon">): TreeBase => ({
  commonName: null,
  plantedYear: null,
  heightM: null,
  heightClass: null,
  girthCm: null,
  girthClass: null,
  crownM: null,
  remarkable: false,
  address: null,
  url: null,
  ...over,
});

const DATASETS: Dataset[] = [
  {
    city: "brussels",
    source: "City of Brussels · Remarkable trees",
    records: `${BRUSSELS}/bruxelles_arbres_remarquables/records`,
    exports: `${BRUSSELS}/bruxelles_arbres_remarquables/exports/json`,
    geoField: "geo_point_2d",
    girthField: "circonference",
    remarkable: true,
    select: "id_arbres_cms,nom_fr,nom_la,circonference,diametre_cime,url_fr,geo_point_2d",
    parse: (rows) =>
      BrusselsRemarkable.parse(rows).map((r) =>
        base({
          id: `bxl-r-${r.id_arbres_cms}`,
          species: r.nom_la ?? r.nom_fr ?? "Unnamed tree",
          commonName: r.nom_fr ?? null,
          girthCm: r.circonference ? Math.round(r.circonference * 100) : null,
          crownM: measured(r.diametre_cime),
          remarkable: true,
          url: webUrl(r.url_fr),
          lat: r.geo_point_2d.lat,
          lon: r.geo_point_2d.lon,
        }),
      ),
  },
  {
    city: "brussels",
    source: "Brussels-Capital Region · Tree register",
    records: `${BRUSSELS}/arbres-bomen-vbx-be-bm/records`,
    exports: `${BRUSSELS}/arbres-bomen-vbx-be-bm/exports/json`,
    geoField: "geo_point_2d",
    girthField: null,
    remarkable: false,
    select: "id,species,address_fr,geo_point_2d",
    parse: (rows) =>
      BrusselsTrees.parse(rows).map((r) => base({ id: `bxl-${r.id}`, species: r.species ?? "Unnamed tree", address: r.address_fr ?? null, lat: r.geo_point_2d.lat, lon: r.geo_point_2d.lon })),
  },
  {
    city: "ghent",
    source: "Stad Gent · Tree locations",
    records: "https://data.stad.gent/api/explore/v2.1/catalog/datasets/locaties-bomen-gent/records",
    exports: "https://data.stad.gent/api/explore/v2.1/catalog/datasets/locaties-bomen-gent/exports/json",
    geoField: "geo_point_2d",
    girthField: "stamomtrek",
    remarkable: false,
    select: "gis_id,sortiment,hoogte,stamomtrek,aanlegjaar,straatnaam,geo_point_2d",
    parse: (rows) =>
      GhentTrees.parse(rows).map((r) =>
        base({
          id: `gent-${r.gis_id}`,
          species: r.sortiment ?? "Unnamed tree",
          plantedYear: yearOf(r.aanlegjaar),
          heightClass: r.hoogte ? r.hoogte.replace(/\.$/, "").replace(/^([<>])\s*/, "$1 ") : null,
          girthCm: measured(r.stamomtrek),
          address: r.straatnaam ?? null,
          lat: r.geo_point_2d.lat,
          lon: r.geo_point_2d.lon,
        }),
      ),
  },
  {
    city: "paris",
    source: "Ville de Paris · Remarkable trees",
    records: "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arbresremarquablesparis/records",
    exports: "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arbresremarquablesparis/exports/json",
    geoField: "geom_x_y",
    girthField: "arbres_circonferenceencm",
    remarkable: true,
    select: "arbres_idbase,arbres_libellefrancais,arbres_genre,arbres_espece,arbres_circonferenceencm,arbres_hauteurenm,arbres_dateplantation,arbres_adresse,com_url_pdf,geom_x_y",
    parse: (rows) =>
      ParisRemarkable.parse(rows).map((r) =>
        base({
          id: `paris-${r.arbres_idbase}`,
          species: [r.arbres_genre, r.arbres_espece].filter(Boolean).join(" ") || (r.arbres_libellefrancais ?? "Unnamed tree"),
          commonName: r.arbres_libellefrancais ?? null,
          plantedYear: yearOf(r.arbres_dateplantation),
          heightM: measured(r.arbres_hauteurenm),
          girthCm: measured(r.arbres_circonferenceencm),
          remarkable: true,
          address: r.arbres_adresse ?? null,
          url: webUrl(r.com_url_pdf),
          lat: r.geom_x_y.lat,
          lon: r.geom_x_y.lon,
        }),
      ),
  },
  {
    city: "paris",
    source: "Ville de Paris · Tree register",
    records: "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/records",
    exports: "https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/les-arbres/exports/json",
    geoField: "geo_point_2d",
    girthField: "circonferenceencm",
    remarkable: false,
    select: "idbase,libellefrancais,genre,espece,circonferenceencm,hauteurenm,adresse,geo_point_2d",
    parse: (rows) =>
      ParisTrees.parse(rows).map((r) =>
        base({
          id: `paris-${r.idbase}`,
          species: [r.genre, r.espece].filter(Boolean).join(" ") || (r.libellefrancais ?? "Unnamed tree"),
          commonName: r.libellefrancais ?? null,
          heightM: measured(r.hauteurenm),
          girthCm: measured(r.circonferenceencm),
          address: r.adresse ?? null,
          lat: r.geo_point_2d.lat,
          lon: r.geo_point_2d.lon,
        }),
      ),
  },
  {
    city: "bologna",
    source: "Comune di Bologna · Alberi",
    records: "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/alberi-manutenzioni/records",
    exports: "https://opendata.comune.bologna.it/api/explore/v2.1/catalog/datasets/alberi-manutenzioni/exports/json",
    geoField: "geo_point_2d",
    girthField: null,
    remarkable: false,
    select: "num_pt,classe,cl_h,classe_circonferenza_diametro,pregio,data_impnt,geo_point_2d",
    parse: (rows) =>
      BolognaTrees.parse(rows).map((r) =>
        base({
          id: `bo-${r.num_pt}`,
          species: r.classe ?? "Unnamed tree",
          plantedYear: yearOf(r.data_impnt),
          heightClass: bolognaHeight(r.cl_h),
          girthClass: bolognaGirth(r.classe_circonferenza_diametro),
          remarkable: r.pregio === "S",
          lat: r.geo_point_2d.lat,
          lon: r.geo_point_2d.lon,
        }),
      ),
  },
];

const OdsRecords = z.object({ results: z.array(z.unknown()) });

const citiesAt = (p: LatLon): CityId[] => CITIES.filter(({ box }) => p.lat >= box.south && p.lat <= box.north && p.lon >= box.west && p.lon <= box.east).map((c) => c.id);
const datasetsFor = (ids: CityId[]): Dataset[] => DATASETS.filter((d) => ids.includes(d.city));

/** Numbers only: Opendatasoft's geometry filters take coordinates and a distance. */
const num = (v: number): string => {
  if (!Number.isFinite(v)) throw new HttpError(400, "bad_query", "Coordinates must be numbers");
  return v.toFixed(6);
};

async function within(d: Dataset, at: LatLon, radiusM: number, limit: number, thickest: boolean): Promise<TreeBase[]> {
  const url = new URL(d.records);
  url.searchParams.set("where", `within_distance(${d.geoField}, geom'POINT(${num(at.lon)} ${num(at.lat)})', ${Math.round(radiusM)}m)`);
  url.searchParams.set("select", d.select);
  url.searchParams.set("limit", String(limit));
  if (thickest && d.girthField) url.searchParams.set("order_by", `${d.girthField} desc`);
  const key = `dossier-trees:${d.records}:${at.lat.toFixed(5)},${at.lon.toFixed(5)}:${Math.round(radiusM)}:${limit}:${thickest}`;
  const data = await memo(key, 600_000, () => fetchJson(d.source, url, OdsRecords, { timeoutMs: 15_000 }));
  return d.parse(data.results);
}

function located(at: LatLon, trees: TreeBase[], radiusM: number): TreeRecord[] {
  // The remarkable list and the general register can hold the same tree; the remarkable entry has more to say.
  const byId = new Map<string, TreeBase>();
  for (const t of trees) if (!byId.has(t.id) || t.remarkable) byId.set(t.id, t);
  return [...byId.values()]
    .map((t) => ({ ...t, distanceM: Math.round(distanceM(at, t)) }))
    .filter((t) => t.distanceM <= radiusM)
    .sort((a, b) => a.distanceM - b.distanceM);
}

/** Registered trees within `radiusM` of a point, nearest first, or null where no register covers the spot. */
export async function treesNear(at: LatLon, radiusM: number, limit: number): Promise<Trees | null> {
  const datasets = datasetsFor(citiesAt(at));
  if (datasets.length === 0) return null;
  const lists = await Promise.all(datasets.map((d) => within(d, at, radiusM, 100, false)));
  const trees = located(at, lists.flat(), radiusM).slice(0, limit);
  return { source: [...new Set(datasets.map((d) => d.source))].join("; "), trees };
}

/** The thickest registered tree within `radiusM`: girth is the best age proxy the registers share. */
export async function thickestNear(at: LatLon, radiusM: number): Promise<{ tree: TreeRecord; source: string } | null> {
  const datasets = datasetsFor(citiesAt(at)).filter((d) => d.girthField);
  const lists = await Promise.all(datasets.map(async (d) => ({ d, trees: located(at, await within(d, at, radiusM, 5, true), radiusM) })));
  let best: { tree: TreeRecord; source: string } | null = null;
  for (const { d, trees } of lists) {
    for (const tree of trees) if (tree.girthCm && (!best || tree.girthCm > (best.tree.girthCm ?? 0))) best = { tree, source: d.source };
  }
  return best;
}

// ── Map layers ──────────────────────────────────────────────────

const toMapTree = (t: TreeBase): MapTree => ({ id: t.id, name: t.commonName ?? t.species, lat: t.lat, lon: t.lon, remarkable: t.remarkable });

/** Every remarkable tree the registers publish, for the "Remarkable trees" layer. Small lists, one fetch each. */
export function remarkableTrees(): Promise<TreeTile> {
  return diskMemo("dossier-remarkable-trees", DAY_MS, async () => {
    const sets = DATASETS.filter((d) => d.remarkable);
    const lists = await Promise.all(
      sets.map(async (d) => {
        const url = new URL(d.exports);
        url.searchParams.set("select", d.select);
        return d.parse(await fetchJson(d.source, url, z.array(z.unknown()), { timeoutMs: 30_000 }));
      }),
    );
    return { sources: sets.map((d) => d.source), trees: lists.flat().map(toMapTree), truncated: false } satisfies TreeTile;
  }, StoredTreeTile);
}

const TILE_ZOOM = 16;
const MAX_TILE_TREES = 2000;

function tileBox(x: number, y: number): { south: number; north: number; west: number; east: number } {
  const n = 2 ** TILE_ZOOM;
  const lon = (tx: number): number => (tx / n) * 360 - 180;
  const lat = (ty: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * 180) / Math.PI;
  return { west: lon(x), east: lon(x + 1), north: lat(y), south: lat(y + 1) };
}

/** All registered trees inside one zoom-16 map tile (about 600 m across). */
export function treeTile(x: number, y: number): Promise<TreeTile> {
  const box = tileBox(x, y);
  const centre = { lat: (box.north + box.south) / 2, lon: (box.east + box.west) / 2 };
  const datasets = datasetsFor(citiesAt(centre));
  if (datasets.length === 0) return Promise.resolve({ sources: [], trees: [], truncated: false });
  return diskMemo(`dossier-trees-tile-${TILE_ZOOM}-${x}-${y}`, DAY_MS, async () => {
    const lists = await Promise.all(
      datasets.map(async (d) => {
        const url = new URL(d.exports);
        url.searchParams.set("where", `in_bbox(${d.geoField}, ${num(box.south)}, ${num(box.west)}, ${num(box.north)}, ${num(box.east)})`);
        url.searchParams.set("select", d.select);
        url.searchParams.set("limit", String(MAX_TILE_TREES));
        return d.parse(await fetchJson(d.source, url, z.array(z.unknown()), { timeoutMs: 30_000 }));
      }),
    );
    const byId = new Map<string, TreeBase>();
    for (const t of lists.flat()) if (!byId.has(t.id) || t.remarkable) byId.set(t.id, t);
    const all = [...byId.values()];
    return { sources: [...new Set(datasets.map((d) => d.source))], trees: all.slice(0, MAX_TILE_TREES).map(toMapTree), truncated: all.length > MAX_TILE_TREES } satisfies TreeTile;
  }, StoredTreeTile);
}
