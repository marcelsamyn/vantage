import { HttpError, fetchJson, fetchUpstream, memo, z } from "../../server/kit";
import { USER_AGENT, webcam, type CameraFields, type Operator } from "./camera.server";
import type { ListedProvider } from "./providers.server";

/**
 * Cameras in places nobody goes: volcanoes, the open ocean, Antarctica, observatories and aurora stations.
 * Every camera here is published by its operator for the public to watch. Coordinates of volcano
 * cameras are approximate: they place the camera at the feature it watches.
 */

const HEADERS = { "user-agent": USER_AGENT };
const WORLD: ListedProvider["bbox"] = [-90, -180, 90, 180];
const TEN_MINUTES = 600_000;

// ── Volcano observatories (curated) ───────────────────────────────

const USGS: Operator = { provider: "usgs", providerName: "USGS Volcano Hazards Program", kind: "volcano", license: "USGS, public domain", refreshS: 300, tz: "Pacific/Honolulu" };
const HVO = "https://volcanoes.usgs.gov/observatories/hvo/cams";

const USGS_CAMERAS: CameraFields[] = [
  { id: "V1cam", name: "Kīlauea · Halemaʻumaʻu crater, west rim", lat: 19.4069, lon: -155.2834, image: `${HVO}/V1cam/images/M.jpg` },
  { id: "KWcam", name: "Kīlauea · crater floor from the west rim", lat: 19.406, lon: -155.295, image: `${HVO}/KWcam/images/M.jpg` },
  { id: "PWcam", name: "Puʻu ʻŌʻō · west flank", lat: 19.3886, lon: -155.1067, image: `${HVO}/PWcam/images/M.jpg` },
  { id: "MLcam", name: "Mauna Loa · Mokuaweoweo caldera, northwest rim", lat: 19.4721, lon: -155.5922, image: `${HVO}/MLcam/images/M.jpg` },
  { id: "HLcam", name: "Mauna Loa · northwest flank, seen from Hualālai", lat: 19.6893, lon: -155.8663, image: "https://volcanoes.usgs.gov/cams/HLcam/images/M.jpg" },
  { id: "MK2cam", name: "Mauna Loa · summit, seen from Mauna Kea", lat: 19.8207, lon: -155.4681, image: "https://volcanoes.usgs.gov/cams/MK2cam/images/M.jpg" },
  { id: "jro", name: "Mount St. Helens · from Johnston Ridge", lat: 46.2751, lon: -122.2169, image: "https://volcanoes.usgs.gov/vsc/captures/st_helens/jro-webcam.jpg", tz: "America/Los_Angeles" },
  { id: "ylake", name: "Yellowstone Lake · over the caldera", lat: 44.4605, lon: -110.37, image: "https://volcanoes.usgs.gov/vsc/captures/yellowstone/current_ylake.jpg", tz: "America/Denver" },
];

const usgs: ListedProvider = {
  id: "usgs",
  name: "USGS Volcano Hazards Program",
  bbox: WORLD,
  load: async () => USGS_CAMERAS.flatMap((c) => webcam(USGS, c)),
};

// ── Alaska and Cascades volcano cameras (USGS AshCam feed) ────────

const AVO: Operator = { provider: "avo", providerName: "USGS Alaska Volcano Observatory", kind: "volcano", license: "USGS Alaska Volcano Observatory and FAA weather cameras, public domain", refreshS: 600 };
const AvoFeed = z.object({
  webcams: z.array(
    z.object({
      webcamCode: z.string(),
      webcamName: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      vName: z.string().nullable(),
      currentImageUrl: z.string().nullable(),
      lastImageTimestamp: z.number().nullable(),
    }),
  ),
});
const FRESH_MS = 3 * 3_600_000;
const PER_VOLCANO = 1;

/** US time zone for a point in Alaska or the Cascades. */
function usTimeZone(lat: number, lon: number): string {
  if (lon < -169.5) return "America/Adak";
  if (lat >= 51 || lon < -130) return "America/Anchorage";
  return lon < -117 ? "America/Los_Angeles" : "America/Denver";
}

const alaskaVolcanoes: ListedProvider = {
  id: "avo",
  name: "USGS Alaska Volcano Observatory",
  bbox: [37, -170, 72, -115],
  load: () =>
    memo("webcams-avo", TEN_MINUTES, async () => {
      const feed = await fetchJson("USGS AshCam", "https://volcview.wr.usgs.gov/ashcam-api/webcamApi/webcams", AvoFeed, { timeoutMs: 30_000, headers: HEADERS });
      const now = Date.now();
      const perVolcano = new Map<string, number>();
      return feed.webcams
        .flatMap((c) => (c.vName && c.currentImageUrl && c.lastImageTimestamp !== null && now - c.lastImageTimestamp * 1000 < FRESH_MS ? [{ ...c, vName: c.vName, currentImageUrl: c.currentImageUrl }] : []))
        .sort((a, b) => (b.lastImageTimestamp ?? 0) - (a.lastImageTimestamp ?? 0))
        .flatMap((c) => {
          // Some volcanoes have a dozen views; the newest one per volcano keeps the gallery varied.
          const used = perVolcano.get(c.vName) ?? 0;
          if (used >= PER_VOLCANO) return [];
          perVolcano.set(c.vName, used + 1);
          return webcam(AVO, {
            id: c.webcamCode,
            name: c.webcamName.startsWith(c.vName) ? c.webcamName : `${c.vName} · ${c.webcamName}`,
            lat: c.latitude,
            lon: c.longitude,
            image: c.currentImageUrl,
            tz: usTimeZone(c.latitude, c.longitude),
            capturedAt: (c.lastImageTimestamp ?? 0) * 1000,
          });
        });
    }),
};

// ── Antarctic stations (Australian Antarctic Division) ────────────

const AAD: Operator = { provider: "aad", providerName: "Australian Antarctic Division", kind: "polar", license: "Australian Antarctic Division, Commonwealth of Australia", refreshS: 600 };
const AAD_STATIONS = [
  { slug: "casey", name: "Casey station, Antarctica", lat: -66.2822, lon: 110.5233, tz: "Antarctica/Casey" },
  { slug: "davis", name: "Davis station, Antarctica", lat: -68.5767, lon: 77.9675, tz: "Antarctica/Davis" },
  { slug: "mawson", name: "Mawson station, Antarctica", lat: -67.6033, lon: 62.8733, tz: "Antarctica/Mawson" },
  { slug: "macquarie-island", name: "Macquarie Island station", lat: -54.4997, lon: 158.9381, tz: "Antarctica/Macquarie" },
] as const;
/** The station pages embed the newest picture under a time-stamped name, e.g. C2610081936s.jpg (yymmddHHMM, UTC). */
const AAD_IMAGE = /https:\/\/images\.antarctica\.gov\.au\/webcams\/[a-z]+\/\d{4}\/\d{2}\/\d{2}\/[A-Z](\d{2})(\d{2})(\d{2})(\d{2})(\d{2})s\.jpg/;

const antarctica: ListedProvider = {
  id: "aad",
  name: "Australian Antarctic Division",
  bbox: [-80, -180, -50, 180],
  load: () =>
    memo("webcams-aad", TEN_MINUTES, async () => {
      const found = await Promise.allSettled(
        AAD_STATIONS.map(async (s): Promise<CameraFields> => {
          const res = await fetchUpstream("Australian Antarctic Division", `https://www.antarctica.gov.au/antarctic-operations/webcams/${s.slug}/`, { headers: HEADERS });
          const m = (await res.text()).match(AAD_IMAGE);
          if (!m) throw new HttpError(502, "upstream_shape", `The ${s.name} webcam page shows no picture`);
          const [, yy = "0", mo = "1", dd = "1", hh = "0", mi = "0"] = m;
          return { id: s.slug, name: s.name, lat: s.lat, lon: s.lon, image: m[0], tz: s.tz, capturedAt: Date.UTC(2000 + Number(yy), Number(mo) - 1, Number(dd), Number(hh), Number(mi)) };
        }),
      );
      const cameras = found.flatMap((r) => (r.status === "fulfilled" ? webcam(AAD, r.value) : []));
      if (cameras.length === 0) throw new HttpError(502, "upstream_shape", "The Australian Antarctic Division webcam pages show no pictures");
      return cameras;
    }),
};

// ── Aurora and observatory cameras (curated) ──────────────────────

const AURORA_KIRUNA: Operator = { provider: "irf", providerName: "Swedish Institute of Space Physics", kind: "sky", license: "Swedish Institute of Space Physics (IRF), Kiruna", refreshS: 60, tz: "Europe/Stockholm" };
const AURORA_SODANKYLA: Operator = { provider: "sgo", providerName: "Sodankylä Geophysical Observatory", kind: "sky", license: "Sodankylä Geophysical Observatory, University of Oulu", refreshS: 60, tz: "Europe/Helsinki" };
const LA_PALMA: Operator = { provider: "orm", providerName: "Roque de los Muchachos Observatory", kind: "observatory", license: "Instituto de Astrofísica de Canarias and the telescope operators", refreshS: 120, tz: "Atlantic/Canary" };

const sky: ListedProvider = {
  id: "sky",
  name: "Aurora and observatory cameras",
  bbox: WORLD,
  load: async () => [
    ...webcam(AURORA_KIRUNA, { id: "kiruna", name: "Kiruna · aurora all-sky camera", lat: 67.8407, lon: 20.4111, image: "https://www.irf.se/alis/allsky/krn/latest_medium.jpeg" }),
    ...webcam(AURORA_SODANKYLA, { id: "sodankyla", name: "Sodankylä · aurora all-sky camera", lat: 67.3667, lon: 26.6333, image: "https://www.sgo.fi/Data/RealTime/Kuvat/SOD.jpg" }),
    ...webcam(LA_PALMA, { id: "gtc-allsky", kind: "sky", name: "La Palma · all-sky camera at the Gran Telescopio Canarias", lat: 28.7564, lon: -17.8918, image: "https://www.gtc.iac.es/multimedia/netcam/camaraAllSky.jpg" }),
    ...webcam(LA_PALMA, { id: "not-caldera", name: "La Palma · Nordic Optical Telescope, view of the caldera", lat: 28.7573, lon: -17.885, image: "https://www.not.iac.es/weather/img/dyn/caldera.jpg", refreshS: 120 }),
    ...webcam(LA_PALMA, { id: "mercator", name: "La Palma · Mercator Telescope, outdoor camera", lat: 28.7619, lon: -17.8794, image: "https://www.mercator.iac.es/static/img/webcam/outdoor/image.jpg", refreshS: 300 }),
  ],
};

// ── Ocean buoys (NOAA National Data Buoy Center) ──────────────────

const NDBC: Operator = { provider: "ndbc", providerName: "NOAA National Data Buoy Center", kind: "ocean", license: "NOAA National Data Buoy Center, public domain", refreshS: 1800 };
const NdbcFeed = z.array(z.object({ id: z.string(), name: z.string(), lat: z.number(), lng: z.number(), img: z.string().nullable() }));

/** Buoys are far from any time zone, so they keep nautical time: one zone per 15° of longitude. */
function nauticalZone(lon: number): string {
  const hours = Math.round(lon / 15);
  return hours === 0 ? "Etc/UTC" : `Etc/GMT${hours > 0 ? "-" : "+"}${Math.abs(hours)}`;
}

const buoys: ListedProvider = {
  id: "ndbc",
  name: "NOAA ocean buoys",
  bbox: WORLD,
  load: () =>
    memo("webcams-ndbc", TEN_MINUTES, async () => {
      const feed = await fetchJson("NOAA buoy cameras", "https://www.ndbc.noaa.gov/buoycams.php", NdbcFeed, { headers: HEADERS });
      return feed.flatMap((b) => {
        // Buoys whose camera is offline list no picture.
        if (!b.img) return [];
        // Names look like "SOUTH HATTERAS - 225 NM South of Cape Hatteras".
        const [place = b.name, ...rest] = b.name.split(" - ");
        const title = place.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, a: string, c: string) => `${a}${c.toUpperCase()}`);
        const stamp = b.img.match(/_(\d{4})_(\d{2})_(\d{2})_(\d{2})(\d{2})\.jpg$/);
        return webcam(NDBC, {
          id: b.id,
          name: rest.length ? `${title} · ${rest.join(" - ")}` : title,
          lat: b.lat,
          lon: b.lng,
          image: `https://www.ndbc.noaa.gov/buoycam.php?station=${encodeURIComponent(b.id)}`,
          tz: nauticalZone(b.lng),
          frames: 6,
          capturedAt: stamp ? Date.UTC(Number(stamp[1]), Number(stamp[2]) - 1, Number(stamp[3]), Number(stamp[4]), Number(stamp[5])) : null,
        });
      });
    }),
};

export const remoteProviders: ListedProvider[] = [usgs, alaskaVolcanoes, antarctica, sky, buoys];
