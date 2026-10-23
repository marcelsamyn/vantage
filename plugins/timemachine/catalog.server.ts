/**
 * The registry of historical maps and aerial photographs the Time machine can show.
 *
 * Every entry comes from a public service that documents itself: a WMTS or WMS whose GetCapabilities
 * names the layer. The browser loads tiles straight from the publisher, so this list is the only place
 * that decides which hosts the app talks to. `bbox` is a cheap pre-filter; `coverage.server.ts` checks the
 * real picture at the place that is on screen, because most of these surveys cover only part of their box.
 */
import type { Era } from "./types";

type Box = readonly [west: number, south: number, east: number, north: number];

export interface EraDef extends Omit<Era, "label"> {
  /** Where the source can have pictures at all. */
  bbox: Box;
  /** A tile this small or smaller is the publisher's empty tile. */
  blankMaxBytes: number;
  /** Covers the whole planet, so it needs no coverage check. */
  global?: boolean;
}

const WORLD: Box = [-180, -85, 180, 85];

const PUBLISHER = {
  flanders: "Digitaal Vlaanderen",
  ngi: "NGI Belgium",
  spw: "Service public de Wallonie",
  urbis: "Paradigm · UrbIS",
  ign: "IGN",
  swisstopo: "swisstopo",
  pcn: "Geoportale Nazionale",
  nasa: "NASA GIBS",
} as const;

const LICENCE = {
  flanders: "Free to use (Digitaal Vlaanderen terms)",
  ngi: "NGI view service, no licence stated",
  spw: "Free to use, cite SPW",
  urbis: "CC0",
  ign: "IGN open licence",
  swisstopo: "Open data, credit swisstopo",
  pcn: "Free to view, no conditions stated",
  nasa: "Open data, NASA EOSDIS",
} as const;

const FLANDERS: Box = [2.52, 50.64, 5.94, 51.51];
const BELGIUM: Box = [2.52, 49.48, 6.47, 51.51];
const WALLONIA: Box = [2.56, 49.45, 6.5, 50.96];
const BRUSSELS: Box = [4.2, 50.74, 4.5, 50.94];
const FRANCE: Box = [-5.3, 41.2, 9.8, 51.2];
const SWITZERLAND: Box = [5.95, 45.8, 10.5, 47.85];
const ITALY: Box = [6.6, 35.4, 18.6, 47.1];

const flandersHistcart = (layer: string): string =>
  `https://geo.api.vlaanderen.be/HISTCART/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

const flandersOrtho = (layer: string): string =>
  `https://geo.api.vlaanderen.be/OKZ/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=&FORMAT=image/png&TILEMATRIXSET=GoogleMapsVL&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

const walloniaWms = (service: string): string =>
  `https://geoservices.wallonie.be/arcgis/services/CARTES_ANCIENNES/${service}/MapServer/WMSServer?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&LAYERS=0&STYLES=&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&BBOX={bbox-epsg-3857}`;

const ngiTiles = (year: number): string => {
  const decade = `${Math.floor(year / 10) * 10}s`;
  return `https://wmts.ngi.be/orthophotos_${decade}/1.0.0/orthophoto_${year}/default/3857/latest/{z}/{y}/{x}.png`;
};

const ign = (layer: string, style: string, matrixSet: string, format: "png" | "jpeg"): string =>
  `https://data.geopf.fr/wmts?SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&LAYER=${layer}&STYLE=${style}&FORMAT=image/${format}&TILEMATRIXSET=${matrixSet}&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}`;

const swisstopo = (layer: string, time: string, ext: "png" | "jpeg"): string => `https://wmts.geo.admin.ch/1.0.0/${layer}/default/${time}/3857/{z}/{x}/{y}.${ext}`;

const italyWms = (mapFile: string, layers: string): string =>
  `http://wms.pcn.minambiente.it/ogc?map=/ms_ogc/WMS_v1.3/raster/${mapFile}.map&SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&FORMAT=image/png&TRANSPARENT=true&STYLES=&SRS=EPSG:3857&WIDTH=256&HEIGHT=256&LAYERS=${layers}&BBOX={bbox-epsg-3857}`;

const gibs = (layer: string, date: string, matrixSet: string, ext: "jpg" | "png"): string =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer}/default/${date}/${matrixSet}/{z}/{y}/{x}.${ext}`;

type Draft = Omit<EraDef, "year" | "yearLabel" | "viewZoom"> & { year: number; yearLabel?: string; viewZoom?: number };
/** Scans stay sharp to their last real zoom level; the default viewing zoom is that level, but never closer than street scale. */
const era = ({ yearLabel, viewZoom, ...rest }: Draft): EraDef => ({ ...rest, yearLabel: yearLabel ?? String(rest.year), viewZoom: viewZoom ?? Math.min(16, rest.maxzoom) });

/** Years of the NGI aerial mosaics that are worth listing. Each flight covers only part of Belgium. */
const NGI_YEARS = [1947, 1948, 1950, 1951, 1952, 1954, 1960, 1961, 1966, 1969, 1970, 1971, 1976, 1977, 1978, 1979, 1989, 1995, 1997, 1998, 1999] as const;

function utcDate(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Every era the app knows. Order is priority: when two sources show the same year and kind,
 * the first one that has a picture at the place wins, so regional sources come before national ones.
 */
export function catalog(now: Date = new Date()): EraDef[] {
  const yesterday = utcDate(now, 1);
  return [
    // ── Flanders ────────────────────────────────────────────────
    era({ id: "flanders.pourbus", viewZoom: 14, year: 1571, name: "Pourbus", kind: "map", context: "Pieter Pourbus painted the map of the Brugse Vrije, the countryside around Bruges, in 1571.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersHistcart("pourbus"), bbox: [2.8, 51.0, 3.8, 51.5], minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),
    era({ id: "flanders.frickx", viewZoom: 13, year: 1712, name: "Fricx", kind: "map", context: "Eugène Henri Fricx's map of the provinces of the Low Countries, 1712.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersHistcart("frickx"), bbox: FLANDERS, minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),
    era({ id: "flanders.ferraris", year: 1777, name: "Ferraris", kind: "map", context: "Count de Ferraris mapped the Austrian Netherlands for the empress, 1771–1778.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersHistcart("ferraris"), bbox: FLANDERS, minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),
    era({ id: "flanders.vandermaelen", year: 1850, name: "Vandermaelen", kind: "map", context: "Philippe Vandermaelen's topographic map of Belgium at 1:20,000, engraved 1846–1854.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersHistcart("vandermaelen"), bbox: FLANDERS, minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),
    era({ id: "flanders.popp", year: 1860, yearLabel: "1842–79", name: "Popp", kind: "map", context: "Popp's cadastral atlas of Belgium: every parcel and building plot, surveyed 1842–1879.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersHistcart("popp"), bbox: FLANDERS, minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),
    era({ id: "flanders.1971", year: 1971, name: "aerial", kind: "aerial", context: "Black-and-white aerial survey of Flanders, 1971.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersOrtho("okzpan71vl"), bbox: FLANDERS, minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),
    era({ id: "flanders.1979", year: 1985, yearLabel: "1979–90", name: "aerial", kind: "aerial", context: "Colour aerial survey of Flanders, flown between 1979 and 1990.", publisher: PUBLISHER.flanders, licence: LICENCE.flanders, tiles: flandersOrtho("okzrgb79_90vl"), bbox: FLANDERS, minzoom: 0, maxzoom: 17, blankMaxBytes: 1800 }),

    // ── Wallonia ────────────────────────────────────────────────
    era({ id: "wallonia.ferraris", year: 1777, name: "Ferraris", kind: "map", context: "Count de Ferraris mapped the Austrian Netherlands for the empress, 1771–1778.", publisher: PUBLISHER.spw, licence: LICENCE.spw, tiles: walloniaWms("FERRARIS"), bbox: WALLONIA, minzoom: 0, maxzoom: 17, blankMaxBytes: 900 }),
    era({ id: "wallonia.vandermaelen", year: 1850, name: "Vandermaelen", kind: "map", context: "Philippe Vandermaelen's topographic map of Belgium at 1:20,000, engraved 1846–1854.", publisher: PUBLISHER.spw, licence: LICENCE.spw, tiles: walloniaWms("VDML"), bbox: [2.78, 49.48, 6.16, 50.86], minzoom: 0, maxzoom: 17, blankMaxBytes: 900 }),
    era({ id: "wallonia.depot", year: 1872, yearLabel: "1865–80", name: "Dépôt de la Guerre", kind: "map", context: "The Belgian War Depot's topographic map, surveyed 1865–1880.", publisher: PUBLISHER.spw, licence: LICENCE.spw, tiles: walloniaWms("DEPOT_GUERRE_1865_1880"), bbox: [2.83, 49.46, 6.15, 50.83], minzoom: 0, maxzoom: 17, blankMaxBytes: 900 }),

    // ── Belgium: the National Geographic Institute's aerial mosaics ──
    ...NGI_YEARS.map((year) =>
      era({
        id: `ngi.${year}`,
        year,
        name: "aerial",
        kind: "aerial",
        context: `Aerial photographs of Belgium from ${year}, scanned and orthorectified by the National Geographic Institute.`,
        publisher: PUBLISHER.ngi,
        licence: LICENCE.ngi,
        tiles: ngiTiles(year),
        bbox: BELGIUM,
        minzoom: 7,
        maxzoom: 17,
        blankMaxBytes: 3000,
      }),
    ),

    // ── Brussels ────────────────────────────────────────────────
    era({ id: "urbis.2004", year: 2004, name: "aerial", kind: "aerial", context: "Aerial photographs of the Brussels-Capital Region, 2004.", publisher: PUBLISHER.urbis, licence: LICENCE.urbis, tiles: "https://geoservices-urbis.irisnet.be/geowebcache/service/wmts/rest/Ortho2004/default/EPSG:900913/EPSG:900913:{z}/{y}/{x}?format=image/jpeg", bbox: BRUSSELS, minzoom: 0, maxzoom: 19, blankMaxBytes: 1800 }),

    // ── France ──────────────────────────────────────────────────
    era({ id: "ign.cassini", viewZoom: 13, year: 1789, name: "Cassini", kind: "map", context: "The Cassini family surveyed all of France by triangulation, 1756–1789: the first map of a whole country built that way.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("AN-IGNF_GEOGRAPHICALGRIDSYSTEMS.CASSINI", "normal", "PM_0_14", "jpeg"), bbox: FRANCE, minzoom: 0, maxzoom: 14, blankMaxBytes: 1700 }),
    era({ id: "ign.etatmajor", viewZoom: 14, year: 1840, yearLabel: "1820–66", name: "État-major", kind: "map", context: "The French army's staff map, drawn between 1820 and 1866.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("GEOGRAPHICALGRIDSYSTEMS.ETATMAJOR40", "normal", "PM_6_15", "jpeg"), bbox: FRANCE, minzoom: 6, maxzoom: 15, blankMaxBytes: 1700 }),
    era({ id: "ign.1950map", viewZoom: 14, year: 1950, name: "map", kind: "map", context: "IGN's 1:50,000 map of France as printed in 1950.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("GEOGRAPHICALGRIDSYSTEMS.MAPS.SCAN50.1950", "normal", "PM_3_15", "jpeg"), bbox: FRANCE, minzoom: 3, maxzoom: 15, blankMaxBytes: 1700 }),
    era({ id: "ign.1950", year: 1957, yearLabel: "1950–65", name: "aerial", kind: "aerial", context: "France in the 1950s, before the great works of the 1960s, from IGN's scanned aerial photographs.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("ORTHOIMAGERY.ORTHOPHOTOS.1950-1965", "BDORTHOHISTORIQUE", "PM_0_18", "png"), bbox: FRANCE, minzoom: 0, maxzoom: 18, blankMaxBytes: 1700 }),
    era({ id: "ign.1965", year: 1972, yearLabel: "1965–80", name: "aerial", kind: "aerial", context: "French aerial photographs from 1965 to 1980, scanned and orthorectified by IGN.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("ORTHOIMAGERY.ORTHOPHOTOS.1965-1980", "BDORTHOHISTORIQUE", "PM_3_18", "png"), bbox: FRANCE, minzoom: 3, maxzoom: 18, blankMaxBytes: 1700 }),
    era({ id: "ign.1980", year: 1987, yearLabel: "1980–95", name: "aerial", kind: "aerial", context: "French aerial photographs from 1980 to 1995, scanned and orthorectified by IGN.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("ORTHOIMAGERY.ORTHOPHOTOS.1980-1995", "BDORTHOHISTORIQUE", "PM_3_18", "png"), bbox: FRANCE, minzoom: 3, maxzoom: 18, blankMaxBytes: 1700 }),
    era({ id: "ign.2000", year: 2002, yearLabel: "2000–05", name: "aerial", kind: "aerial", context: "French aerial photographs from 2000 to 2005.", publisher: PUBLISHER.ign, licence: LICENCE.ign, tiles: ign("ORTHOIMAGERY.ORTHOPHOTOS2000-2005", "normal", "PM_6_18", "jpeg"), bbox: FRANCE, minzoom: 6, maxzoom: 18, blankMaxBytes: 1700 }),

    // ── Switzerland ─────────────────────────────────────────────
    era({ id: "swisstopo.dufour", viewZoom: 14, year: 1855, name: "Dufour", kind: "map", context: "General Dufour's first national map of Switzerland, surveyed 1845–1865.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.hiks-dufour", "current", "png"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 17, blankMaxBytes: 400 }),
    era({ id: "swisstopo.siegfried", viewZoom: 15, year: 1900, name: "Siegfried", kind: "map", context: "The Siegfried atlas, Switzerland's detailed map at 1:25,000 and 1:50,000, published 1870–1926.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.hiks-siegfried", "1900", "png"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 17, blankMaxBytes: 400 }),
    era({ id: "swisstopo.1930", viewZoom: 15, year: 1930, name: "map", kind: "map", context: "The Swiss national map as it stood in 1930.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.zeitreihen", "19301231", "png"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 17, blankMaxBytes: 400 }),
    era({ id: "swisstopo.1946", year: 1946, name: "aerial", kind: "aerial", context: "Swiss aerial photographs from 1946, orthorectified by swisstopo.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.swissimage-product_1946", "1946", "jpeg"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 17, blankMaxBytes: 400 }),
    era({ id: "swisstopo.1960", year: 1960, name: "aerial", kind: "aerial", context: "Swiss aerial photographs from 1960, orthorectified by swisstopo.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.swissimage-product", "1960", "jpeg"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 18, blankMaxBytes: 400 }),
    era({ id: "swisstopo.1970", viewZoom: 15, year: 1970, name: "map", kind: "map", context: "The Swiss national map as it stood in 1970.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.zeitreihen", "19701231", "png"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 17, blankMaxBytes: 400 }),
    era({ id: "swisstopo.1998", year: 1998, name: "aerial", kind: "aerial", context: "Swiss aerial photographs from 1998, orthorectified by swisstopo.", publisher: PUBLISHER.swisstopo, licence: LICENCE.swisstopo, tiles: swisstopo("ch.swisstopo.swissimage-product", "1998", "jpeg"), bbox: SWITZERLAND, minzoom: 0, maxzoom: 18, blankMaxBytes: 400 }),

    // ── Italy ───────────────────────────────────────────────────
    era({ id: "pcn.1988", year: 1988, yearLabel: "1988–89", name: "aerial", kind: "aerial", context: "Black-and-white aerial survey of all Italy, flown mostly in 1988 and 1989.", publisher: PUBLISHER.pcn, licence: LICENCE.pcn, tiles: italyWms("ortofoto_bn_88", "OI.ORTOIMMAGINI.1988.32,OI.ORTOIMMAGINI.1988.33"), bbox: ITALY, minzoom: 12, maxzoom: 16, blankMaxBytes: 400 }),
    era({ id: "pcn.1994", year: 1996, yearLabel: "1994–98", name: "aerial", kind: "aerial", context: "Black-and-white aerial survey of Italy, flown between 1994 and 1998.", publisher: PUBLISHER.pcn, licence: LICENCE.pcn, tiles: italyWms("ortofoto_bn_94", "OI.ORTOIMMAGINI.1994.32,OI.ORTOIMMAGINI.1994.33"), bbox: ITALY, minzoom: 12, maxzoom: 16, blankMaxBytes: 400 }),
    era({ id: "pcn.2000", year: 2000, name: "aerial", kind: "aerial", context: "Colour aerial survey of Italy, 2000.", publisher: PUBLISHER.pcn, licence: LICENCE.pcn, tiles: italyWms("ortofoto_colore_00", "OI.ORTOIMMAGINI.2000.32,OI.ORTOIMMAGINI.2000.33"), bbox: ITALY, minzoom: 12, maxzoom: 16, blankMaxBytes: 400 }),

    // ── Anywhere: NASA GIBS ─────────────────────────────────────
    era({ id: "nasa.2012", year: 2012, name: "night lights", kind: "orbit", context: "Earth's city lights, a composite of cloud-free nights in 2012. One pixel is about 500 m.", publisher: PUBLISHER.nasa, licence: LICENCE.nasa, tiles: gibs("VIIRS_Black_Marble", "2012-01-01", "GoogleMapsCompatible_Level8", "png"), bbox: WORLD, global: true, minzoom: 0, maxzoom: 8, blankMaxBytes: 0 }),
    era({ id: "nasa.2016", year: 2016, name: "night lights", kind: "orbit", context: "Earth's city lights, a composite of cloud-free nights in 2016. One pixel is about 500 m.", publisher: PUBLISHER.nasa, licence: LICENCE.nasa, tiles: gibs("VIIRS_Black_Marble", "2016-01-01", "GoogleMapsCompatible_Level8", "png"), bbox: WORLD, global: true, minzoom: 0, maxzoom: 8, blankMaxBytes: 0 }),
    era({ id: "nasa.yesterday", year: now.getUTCFullYear(), yearLabel: "Yesterday", name: "from orbit", kind: "orbit", context: `True-colour view from NASA's Terra satellite on ${yesterday}. One pixel is about 250 m, and the clouds are real.`, publisher: PUBLISHER.nasa, licence: LICENCE.nasa, tiles: gibs("MODIS_Terra_CorrectedReflectance_TrueColor", yesterday, "GoogleMapsCompatible_Level9", "jpg"), bbox: WORLD, global: true, minzoom: 0, maxzoom: 9, blankMaxBytes: 0 }),
  ];
}

export function labelOf(def: Pick<EraDef, "yearLabel" | "name">): string {
  return `${def.yearLabel} · ${def.name}`;
}

export function toEra(def: EraDef): Era {
  const { bbox: _bbox, blankMaxBytes: _blank, global: _global, ...era } = def;
  return { ...era, label: labelOf(def) };
}

const KIND_ORDER = { map: 0, aerial: 1, orbit: 2 } as const;

/** Oldest first. One entry per year, kind and name: when two publishers show the same survey, the first in the catalog wins. */
export function listEras(covered: readonly EraDef[]): Era[] {
  const seen = new Set<string>();
  return covered
    .filter((def) => {
      const key = `${def.year}:${def.kind}:${def.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(toEra)
    .sort((a, b) => a.year - b.year || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}

export function covers(box: Box, lat: number, lon: number): boolean {
  return lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
}

/** The slippy-map tile that holds a point. */
export function tileAt(lat: number, lon: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const sin = Math.sin((lat * Math.PI) / 180);
  const y = Math.floor((0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

const WEB_MERCATOR_HALF = 20_037_508.342789244;

/** Web Mercator metres of a tile, in the order WMS wants: west, south, east, north. */
export function tileBounds(z: number, x: number, y: number): [number, number, number, number] {
  const size = (2 * WEB_MERCATOR_HALF) / 2 ** z;
  return [-WEB_MERCATOR_HALF + x * size, WEB_MERCATOR_HALF - (y + 1) * size, -WEB_MERCATOR_HALF + (x + 1) * size, WEB_MERCATOR_HALF - y * size];
}

/** Fill a MapLibre tile template for one tile. */
export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y))
    .replace("{bbox-epsg-3857}", tileBounds(z, x, y).map((v) => v.toFixed(6)).join(","));
}
