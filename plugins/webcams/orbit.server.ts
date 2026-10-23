import { fetchJson, fetchUpstream, memo, z } from "../../server/kit";
import { USER_AGENT } from "./camera.server";
import type { OrbitFrame } from "./types";

/**
 * Pictures of Earth and the Sun taken from space: the newest frame from each spacecraft's public image feed.
 * A source that fails is skipped, so one outage never empties the screen.
 */

const HEADERS = { "user-agent": USER_AGENT };
const FIVE_MINUTES = 300_000;
const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const lonLabel = (lon: number): string => `${Math.abs(lon).toFixed(1)}° ${lon < 0 ? "W" : "E"}`;

/** Geostationary spacecraft hover 35,786 km above one point on the equator. */
const overEquator = (lon: number): string => `${nf.format(35_786)} km above ${lonLabel(lon)}`;

/** When a file was last written, from its HTTP header. Null when the host does not say. */
async function modifiedAt(url: string): Promise<number | null> {
  const res = await fetchUpstream("image host", url, { method: "HEAD", headers: HEADERS });
  const header = res.headers.get("last-modified");
  const t = header ? Date.parse(header) : Number.NaN;
  return Number.isFinite(t) ? t : null;
}

const utc = (s: string): number => Date.parse(`${s.replace(" ", "T")}Z`);

type Source = () => Promise<OrbitFrame[]>;

// ── NOAA GOES ─────────────────────────────────────────────────────

const NOAA_LICENSE = "NOAA / NESDIS STAR, public domain";

function goes(id: string, satellite: "GOES19" | "GOES18", craft: string, lon: number): Source {
  const base = `https://cdn.star.nesdis.noaa.gov/${satellite}/ABI/FD/GEOCOLOR`;
  return async () => [
    {
      id,
      craft,
      operator: "NOAA",
      subject: "earth",
      title: "Earth, full disk",
      about: "GeoColor: true colour by day, infrared by night, so clouds stay visible in the dark.",
      vantage: overEquator(lon),
      image: `${base}/678x678.jpg`,
      imageLarge: `${base}/1808x1808.jpg`,
      capturedAt: await modifiedAt(`${base}/678x678.jpg`),
      refreshS: 600,
      license: NOAA_LICENSE,
    },
  ];
}

// ── Himawari-9 ────────────────────────────────────────────────────

const HimawariLatest = z.object({ date: z.string() });

const himawari: Source = async () => {
  const latest = await fetchJson("NICT Himawari", "https://himawari8.nict.go.jp/img/D531106/latest.json", HimawariLatest, { headers: HEADERS });
  const t = utc(latest.date);
  const d = new Date(t);
  const p = (n: number): string => String(n).padStart(2, "0");
  const image = `https://himawari8.nict.go.jp/img/D531106/1d/550/${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}_0_0.png`;
  return [
    {
      id: "himawari-9",
      craft: "Himawari-9",
      operator: "Japan Meteorological Agency",
      subject: "earth",
      title: "Earth, full disk",
      about: "The view over Asia and the western Pacific, one picture every ten minutes.",
      vantage: overEquator(140.7),
      image,
      imageLarge: image,
      capturedAt: Number.isFinite(t) ? t : null,
      refreshS: 600,
      license: "Himawari-9 data, Japan Meteorological Agency, via NICT",
    },
  ];
};

// ── DSCOVR EPIC ───────────────────────────────────────────────────

const EpicList = z
  .array(
    z.object({
      image: z.string(),
      date: z.string(),
      centroid_coordinates: z.object({ lat: z.number(), lon: z.number() }),
      dscovr_j2000_position: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    }),
  )
  .min(1);

const epic: Source = async () => {
  const list = await fetchJson("NASA EPIC", "https://epic.gsfc.nasa.gov/api/natural", EpicList, { headers: HEADERS });
  const latest = list[0];
  if (!latest) return [];
  const [day = ""] = latest.date.split(" ");
  const image = `https://epic.gsfc.nasa.gov/archive/natural/${day.replaceAll("-", "/")}/jpg/${latest.image}.jpg`;
  const { x, y, z: zz } = latest.dscovr_j2000_position;
  const km = Math.hypot(x, y, zz);
  const c = latest.centroid_coordinates;
  return [
    {
      id: "dscovr-epic",
      craft: "DSCOVR",
      operator: "NASA and NOAA",
      subject: "earth",
      title: "Earth, the whole sunlit side",
      about: `Natural colour from the EPIC camera. NASA publishes these about a day after they are taken. The picture is centred on ${Math.abs(c.lat).toFixed(1)}° ${c.lat < 0 ? "S" : "N"}, ${lonLabel(c.lon)}.`,
      vantage: `${(km / 1e6).toFixed(2)} million km away, at L1`,
      image,
      imageLarge: image,
      capturedAt: utc(latest.date),
      refreshS: 3600,
      license: "NASA EPIC, public domain",
    },
  ];
};

// ── SDO ───────────────────────────────────────────────────────────

const SDO_VANTAGE = `${nf.format(35_786)} km up, geosynchronous over 102° W`;
const SDO_BANDS = [
  { code: "0193", title: "Sun, corona", about: "Extreme ultraviolet at 193 Å: the Sun's outer atmosphere at about 1.2 million °C. Dark patches are coronal holes." },
  { code: "0304", title: "Sun, chromosphere", about: "Extreme ultraviolet at 304 Å: the layer below the corona at about 50,000 °C, where prominences rise above the edge." },
  { code: "0171", title: "Sun, magnetic loops", about: "Extreme ultraviolet at 171 Å: plasma at about 600,000 °C tracing loops of magnetic field above active regions." },
  { code: "4500", title: "Sun, visible surface", about: "Light at 4500 Å: the Sun's visible surface, where dark sunspots show strong magnetic fields." },
] as const;

const sdo: Source = async () => {
  const listing = async (daysAgo: number): Promise<{ dir: string; html: string }> => {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    const dir = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}`;
    const res = await fetchUpstream("NASA SDO", `https://sdo.gsfc.nasa.gov/assets/img/browse/${dir}/`, { headers: HEADERS });
    return { dir, html: await res.text() };
  };
  let page = await listing(0);
  // Just after midnight UTC the new day's folder is still empty.
  if (!page.html.includes("_512_0193.jpg")) page = await listing(1);
  const { dir, html } = page;
  return SDO_BANDS.flatMap((band) => {
    const names = [...html.matchAll(new RegExp(`(\\d{8})_(\\d{6})_512_${band.code}\\.jpg`, "g"))];
    const last = names.at(-1);
    if (!last) return [];
    const [, date = "", time = ""] = last;
    const stamp = `${date}_${time}`;
    const base = `https://sdo.gsfc.nasa.gov/assets/img/browse/${dir}/${stamp}`;
    return [
      {
        id: `sdo-${band.code}`,
        craft: "SDO",
        operator: "NASA",
        subject: "sun" as const,
        title: band.title,
        about: band.about,
        vantage: SDO_VANTAGE,
        image: `${base}_512_${band.code}.jpg`,
        imageLarge: `${base}_1024_${band.code}.jpg`,
        capturedAt: Date.UTC(Number(date.slice(0, 4)), Number(date.slice(4, 6)) - 1, Number(date.slice(6, 8)), Number(time.slice(0, 2)), Number(time.slice(2, 4)), Number(time.slice(4, 6))),
        refreshS: 900,
        license: "NASA Solar Dynamics Observatory, public domain",
      },
    ];
  });
};

// ── SOHO ──────────────────────────────────────────────────────────

const SOHO_BASE = "https://soho.nascom.nasa.gov/data/realtime";
const SOHO_CAMERAS = [
  { id: "soho-c2", folder: "c2", title: "Sun, inner corona", about: "LASCO C2 coronagraph: a disc blocks the Sun so the corona shows out to 8 solar radii. Streamers and eruptions drift outwards." },
  { id: "soho-c3", folder: "c3", title: "Sun, outer corona", about: "LASCO C3 coronagraph: a wider view of the corona and the solar wind, with stars and planets drifting through the frame." },
] as const;

const soho: Source = async () =>
  Promise.all(
    SOHO_CAMERAS.map(async (cam) => ({
      id: cam.id,
      craft: "SOHO",
      operator: "ESA and NASA",
      subject: "sun" as const,
      title: cam.title,
      about: cam.about,
      vantage: "About 1.5 million km away, at L1",
      image: `${SOHO_BASE}/${cam.folder}/512/latest.jpg`,
      imageLarge: `${SOHO_BASE}/${cam.folder}/1024/latest.jpg`,
      capturedAt: await modifiedAt(`${SOHO_BASE}/${cam.folder}/512/latest.jpg`),
      refreshS: 900,
      license: "SOHO is a project of international cooperation between ESA and NASA",
    })),
  );

const SOURCES: { name: string; load: Source }[] = [
  { name: "GOES-East", load: goes("goes-19", "GOES19", "GOES-19 (GOES-East)", -75.2) },
  { name: "GOES-West", load: goes("goes-18", "GOES18", "GOES-18 (GOES-West)", -137) },
  { name: "Himawari-9", load: himawari },
  { name: "DSCOVR EPIC", load: epic },
  { name: "SDO", load: sdo },
  { name: "SOHO", load: soho },
];

/** The newest picture from every spacecraft source, with the names of the sources that failed. */
export function loadOrbit(): Promise<{ frames: OrbitFrame[]; failed: string[] }> {
  return memo("webcams-orbit", FIVE_MINUTES, async () => {
    const results = await Promise.allSettled(SOURCES.map((s) => s.load()));
    return {
      frames: results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])),
      failed: results.flatMap((r, i) => (r.status === "rejected" ? [SOURCES[i]?.name ?? "source"] : [])),
    };
  });
}
