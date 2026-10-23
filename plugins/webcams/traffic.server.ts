import { diskMemo, fetchJson, fetchUpstream, memo, z } from "../../server/kit";
import { directionBearing } from "./direction";
import { DAY, USER_AGENT, webcam, type Operator } from "./camera.server";
import type { ListedProvider } from "./providers.server";

/** Street cameras: traffic and road-weather cameras that road authorities and cities publish for the public. */

const HEADERS = { "user-agent": USER_AGENT };
/** A camera as `webcam()` builds it. Kept on disk for a day, so what is read back is checked against the fields the code expects. */
export const StoredStream = z.object({ type: z.enum(["hls", "mjpeg"]), url: z.string() });
const StoredWebcams = z.array(
  z.object({
    id: z.string(),
    provider: z.string(),
    providerName: z.string(),
    kind: z.enum(["traffic", "weather", "view", "volcano", "ocean", "polar", "observatory", "sky"]),
    name: z.string(),
    lat: z.number(),
    lon: z.number(),
    image: z.string(),
    video: z.string().nullable(),
    stream: StoredStream.nullable(),
    direction: z.string().nullable(),
    bearing: z.number().min(0).max(360).nullable().optional(),
    refreshS: z.number(),
    license: z.string(),
    page: z.string().nullable(),
    tz: z.string().nullable(),
    frames: z.number(),
    capturedAt: z.number().nullable(),
  }).transform((c) => ({ ...c, bearing: c.bearing ?? directionBearing(c.direction) })),
);

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s(/-])(\p{L})/gu, (_, a: string, b: string) => `${a}${b.toUpperCase()}`);

// ── London ────────────────────────────────────────────────────────

const TFL: Operator = { provider: "tfl", providerName: "Transport for London", kind: "traffic", license: "Powered by TfL Open Data", refreshS: 300 };
const TflCam = z.object({
  id: z.string(),
  commonName: z.string(),
  lat: z.number(),
  lon: z.number(),
  additionalProperties: z.array(z.object({ key: z.string(), value: z.string() })),
});

const tfl: ListedProvider = {
  id: "tfl",
  name: "Transport for London",
  cities: [{ name: "London", lat: 51.5074, lon: -0.1278 }],
  bbox: [51.25, -0.6, 51.75, 0.35],
  load: () =>
    diskMemo("webcams-v2-tfl", DAY, async () => {
      const cams = await fetchJson("TfL JamCams", "https://api.tfl.gov.uk/Place/Type/JamCam", z.array(TflCam), { timeoutMs: 30_000, headers: HEADERS });
      return cams.flatMap((c) => {
        const prop = (k: string): string | undefined => c.additionalProperties.find((p) => p.key === k)?.value;
        const image = prop("imageUrl");
        if (!image || prop("available") === "false") return [];
        return webcam(TFL, { id: c.id, name: c.commonName, lat: c.lat, lon: c.lon, image, video: prop("videoUrl") ?? null, direction: prop("view") ?? null });
      });
    }, StoredWebcams),
};

// ── California ────────────────────────────────────────────────────

const CALTRANS: Operator = { provider: "caltrans", providerName: "Caltrans", kind: "traffic", license: "Caltrans District CCTV, public feed", refreshS: 300 };
const CaltransDistrict = z.object({
  data: z.array(
    z.object({
      cctv: z.object({
        index: z.string(),
        inService: z.string(),
        location: z.object({ locationName: z.string(), route: z.string().default(""), latitude: z.string(), longitude: z.string(), direction: z.string().default("") }),
        imageData: z.object({
          streamingVideoURL: z.string().default(""),
          static: z.object({ currentImageURL: z.string(), currentImageUpdateFrequency: z.string().default("5") }),
        }),
      }),
    }),
  ),
});

const caltrans: ListedProvider = {
  id: "caltrans",
  name: "Caltrans",
  cities: [{ name: "Los Angeles", lat: 34.0522, lon: -118.2437 }, { name: "San Francisco", lat: 37.7749, lon: -122.4194 }, { name: "San Diego", lat: 32.7157, lon: -117.1611 }, { name: "Sacramento", lat: 38.5816, lon: -121.4944 }],
  bbox: [32.4, -124.5, 42.1, -114.1],
  load: async () => {
    const districts = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
    const lists = await Promise.allSettled(
      districts.map((d) =>
        diskMemo(`webcams-v2-caltrans-${d}`, DAY, async () => {
          const data = await fetchJson("Caltrans CCTV", `https://cwwp2.dot.ca.gov/data/d${Number(d)}/cctv/cctvStatusD${d}.json`, CaltransDistrict, { timeoutMs: 90_000, headers: HEADERS });
          return data.data.flatMap(({ cctv: c }) => {
            if (c.inService !== "true") return [];
            const hls = c.imageData.streamingVideoURL;
            return webcam(CALTRANS, {
              id: `${d}-${c.index}`,
              name: [c.location.route, c.location.locationName].filter(Boolean).join(" · "),
              lat: Number.parseFloat(c.location.latitude),
              lon: Number.parseFloat(c.location.longitude),
              image: c.imageData.static.currentImageURL,
              stream: hls.startsWith("https://") && hls.endsWith(".m3u8") ? { type: "hls", url: hls } : null,
              direction: c.location.direction,
              refreshS: Math.max(60, Number.parseInt(c.imageData.static.currentImageUpdateFrequency, 10) * 60 || 300),
            });
          });
        }, StoredWebcams),
      ),
    );
    return lists.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  },
};

// ── Singapore ─────────────────────────────────────────────────────

const SG: Operator = { provider: "sg", providerName: "Singapore LTA (data.gov.sg)", kind: "traffic", license: "Singapore Open Data Licence, Land Transport Authority", refreshS: 60 };
const SgImages = z.object({
  items: z.array(z.object({ cameras: z.array(z.object({ camera_id: z.string(), image: z.string(), location: z.object({ latitude: z.number(), longitude: z.number() }) })) })),
});

const singapore: ListedProvider = {
  id: "sg",
  name: "Singapore Land Transport Authority",
  cities: [{ name: "Singapore", lat: 1.3521, lon: 103.8198 }],
  bbox: [1.15, 103.6, 1.48, 104.1],
  load: () =>
    memo("webcams-sg", 60_000, async () => {
      const d = await fetchJson("data.gov.sg", "https://api.data.gov.sg/v1/transport/traffic-images", SgImages, { headers: HEADERS });
      return (d.items[0]?.cameras ?? []).flatMap((c) => webcam(SG, { id: c.camera_id, name: `Expressway camera ${c.camera_id}`, lat: c.location.latitude, lon: c.location.longitude, image: c.image }));
    }),
};

// ── Hong Kong ─────────────────────────────────────────────────────

const HK: Operator = { provider: "hk", providerName: "Hong Kong Transport Department", kind: "traffic", license: "Transport Department, HKSAR, via data.gov.hk", refreshS: 120 };

const hongKong: ListedProvider = {
  id: "hk",
  name: "Hong Kong Transport Department",
  cities: [{ name: "Hong Kong", lat: 22.3193, lon: 114.1694 }],
  bbox: [22.1, 113.8, 22.6, 114.5],
  load: () =>
    diskMemo("webcams-v2-hk", DAY, async () => {
      const res = await fetchUpstream("Hong Kong Transport Department", "https://static.data.gov.hk/td/traffic-snapshot-images/code/Traffic_Camera_Locations_En.xml", { headers: HEADERS, timeoutMs: 30_000 });
      const xml = await res.text();
      const tag = (block: string, name: string): string => block.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]?.trim() ?? "";
      return [...xml.matchAll(/<image>([\s\S]*?)<\/image>/g)].flatMap((m) => {
        const block = m[1] ?? "";
        const key = tag(block, "key");
        const url = tag(block, "url");
        if (!key || !url.startsWith("https://")) return [];
        return webcam(HK, {
          id: key,
          name: tag(block, "description").replace(/\s*\[[^\]]*\]\s*$/, ""),
          lat: Number.parseFloat(tag(block, "latitude")),
          lon: Number.parseFloat(tag(block, "longitude")),
          image: url,
        });
      });
    }, StoredWebcams),
};

// ── Finland ───────────────────────────────────────────────────────

const FI: Operator = { provider: "fi", providerName: "Fintraffic Digitraffic", kind: "weather", license: "Fintraffic / digitraffic.fi, CC BY 4.0", refreshS: 600 };
const FiStations = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.array(z.number()).min(2) }),
      properties: z.object({
        name: z.string(),
        collectionStatus: z.string(),
        presets: z.array(z.object({ id: z.string(), inCollection: z.boolean() })),
      }),
    }),
  ),
});

const finland: ListedProvider = {
  id: "fi",
  name: "Fintraffic Digitraffic",
  cities: [{ name: "Helsinki", lat: 60.1699, lon: 24.9384 }, { name: "Tampere", lat: 61.4978, lon: 23.761 }, { name: "Oulu", lat: 65.0121, lon: 25.4651 }],
  bbox: [59.5, 19, 70.2, 31.7],
  load: () =>
    diskMemo("webcams-v2-fi", DAY, async () => {
      const data = await fetchJson("Digitraffic weather cameras", "https://tie.digitraffic.fi/api/weathercam/v1/stations", FiStations, { timeoutMs: 30_000, headers: { ...HEADERS, "Digitraffic-User": "VANTAGE/1.0" } });
      return data.features.flatMap((f) => {
        const p = f.properties;
        if (p.collectionStatus !== "GATHERING") return [];
        // Station names look like "kt51_Inkoo": road class and number, then the place.
        const [road = "", ...place] = p.name.split("_");
        const label = place.length ? `${place.join(" ")} · ${road.toUpperCase()}` : p.name;
        const presets = p.presets.filter((x) => x.inCollection);
        return presets.flatMap((preset, i) =>
          webcam(FI, { id: preset.id, name: presets.length > 1 ? `${label} · view ${i + 1}` : label, lon: f.geometry.coordinates[0] ?? 0, lat: f.geometry.coordinates[1] ?? 0, image: `https://weathercam.digitraffic.fi/${preset.id}.jpg` }),
        );
      });
    }, StoredWebcams),
};

// ── New Zealand ───────────────────────────────────────────────────

const NZ: Operator = { provider: "nz", providerName: "NZ Transport Agency", kind: "traffic", license: "NZ Transport Agency Waka Kotahi, journeys.nzta.govt.nz", refreshS: 120 };
const NzCameras = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        ExternalId: z.number(),
        Name: z.string(),
        Offline: z.number(),
        UnderMaintenance: z.number(),
        ImageUrl: z.string(),
        Latitude: z.string(),
        Longitude: z.string(),
        Direction: z.string().default(""),
      }),
    }),
  ),
});

const newZealand: ListedProvider = {
  id: "nz",
  name: "NZ Transport Agency",
  cities: [{ name: "Auckland", lat: -36.8509, lon: 174.7645 }, { name: "Wellington", lat: -41.2866, lon: 174.7756 }, { name: "Christchurch", lat: -43.5321, lon: 172.6362 }],
  bbox: [-47.5, 166, -34, 179],
  load: () =>
    diskMemo("webcams-v2-nz", DAY, async () => {
      const data = await fetchJson("NZTA Journeys", "https://www.journeys.nzta.govt.nz/assets/map-data-cache/cameras.json", NzCameras, { timeoutMs: 30_000, headers: HEADERS });
      return data.features.flatMap(({ properties: c }) => {
        if (c.Offline || c.UnderMaintenance) return [];
        return webcam(NZ, { id: String(c.ExternalId), name: c.Name, lat: Number.parseFloat(c.Latitude), lon: Number.parseFloat(c.Longitude), image: c.ImageUrl, direction: c.Direction });
      });
    }, StoredWebcams),
};

// ── British Columbia ──────────────────────────────────────────────

const BC: Operator = { provider: "bc", providerName: "DriveBC", kind: "traffic", license: "Province of British Columbia, DriveBC", refreshS: 900 };
const BcCameras = z.array(
  z.object({
    id: z.number(),
    name: z.string(),
    highway_display: z.string().default(""),
    orientation: z.string().default(""),
    is_on: z.boolean(),
    should_appear: z.boolean(),
    update_period_mean: z.number().nullable().default(null),
    location: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  }),
);

const britishColumbia: ListedProvider = {
  id: "bc",
  name: "DriveBC",
  cities: [{ name: "Vancouver", lat: 49.2827, lon: -123.1207 }, { name: "Victoria", lat: 48.4284, lon: -123.3656 }, { name: "Kelowna", lat: 49.888, lon: -119.496 }],
  bbox: [48.2, -139.1, 60.1, -114],
  load: () =>
    diskMemo("webcams-v2-bc", DAY, async () => {
      const data = await fetchJson("DriveBC", "https://www.drivebc.ca/api/webcams/", BcCameras, { timeoutMs: 30_000, headers: HEADERS });
      return data.flatMap((c) => {
        if (!c.is_on || !c.should_appear) return [];
        return webcam(BC, {
          id: String(c.id),
          name: [c.highway_display && `Hwy ${c.highway_display}`, c.name].filter(Boolean).join(" · "),
          lon: c.location.coordinates[0],
          lat: c.location.coordinates[1],
          image: `https://www.drivebc.ca/images/${c.id}.jpg`,
          direction: c.orientation,
          refreshS: Math.min(1800, Math.max(60, Math.round(c.update_period_mean ?? 900))),
        });
      });
    }, StoredWebcams),
};

// ── Toronto ───────────────────────────────────────────────────────

const TORONTO: Operator = { provider: "toronto", providerName: "City of Toronto", kind: "traffic", license: "City of Toronto Open Data, Open Government Licence – Toronto", refreshS: 180 };
const TORONTO_HOST = "ckan0.cf.opendata.inter.prod-toronto.ca";
const TorontoPackage =z.object({ result: z.object({ resources: z.array(z.object({ name: z.string(), format: z.string(), url: z.string() })) }) });
const TorontoCameras = z.object({
  features: z.array(
    z.object({
      properties: z.object({ REC_ID: z.number(), IMAGEURL: z.string(), MAINROAD: z.string().default(""), CROSSROAD: z.string().default(""), DIRECTION1: z.string().nullable().default(null) }),
      geometry: z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).min(1) }),
    }),
  ),
});

const toronto: ListedProvider = {
  id: "toronto",
  name: "City of Toronto",
  cities: [{ name: "Toronto", lat: 43.6532, lon: -79.3832 }],
  bbox: [43.55, -79.65, 43.86, -79.1],
  load: () =>
    diskMemo("webcams-v2-toronto", DAY, async () => {
      const pkg = await fetchJson("Toronto Open Data", "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/package_show?id=traffic-cameras", TorontoPackage, { headers: HEADERS });
      // The file URL comes from the operator's package listing, so it must stay on the operator's own host.
      const file = pkg.result.resources.find((r) => r.format === "GeoJSON" && r.name.includes("4326") && new URL(r.url).hostname === TORONTO_HOST);
      if (!file) return [];
      const data = await fetchJson("Toronto Open Data", file.url, TorontoCameras, { timeoutMs: 30_000, headers: HEADERS });
      return data.features.flatMap((f) => {
        const p = f.properties;
        const [lon, lat] = f.geometry.coordinates[0] ?? [0, 0];
        return webcam(TORONTO, { id: String(p.REC_ID), name: [titleCase(p.MAINROAD), titleCase(p.CROSSROAD)].filter(Boolean).join(" at "), lat, lon, image: p.IMAGEURL.replace(/^http:/, "https:"), direction: p.DIRECTION1 });
      });
    }, StoredWebcams),
};

// ── Calgary ───────────────────────────────────────────────────────

const CALGARY: Operator = { provider: "calgary", providerName: "City of Calgary", kind: "traffic", license: "City of Calgary Open Data, Open Government Licence – City of Calgary", refreshS: 60 };
const CalgaryCameras = z.array(
  z.object({
    camera_url: z.object({ url: z.string() }),
    camera_location: z.string().default(""),
    quadrant: z.string().default(""),
    point: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
  }),
);

const calgary: ListedProvider = {
  id: "calgary",
  name: "City of Calgary",
  cities: [{ name: "Calgary", lat: 51.0447, lon: -114.0719 }],
  bbox: [50.84, -114.3, 51.25, -113.85],
  load: () =>
    diskMemo("webcams-v2-calgary", DAY, async () => {
      const data = await fetchJson("Calgary Open Data", "https://data.calgary.ca/resource/k7p9-kppz.json?$limit=1000", CalgaryCameras, { headers: HEADERS });
      return data.flatMap((c) =>
        webcam(CALGARY, { id: c.camera_url.url.match(/loc(\d+)\.jpg/)?.[1] ?? c.camera_location, name: [c.camera_location, c.quadrant].filter(Boolean).join(" "), lon: c.point.coordinates[0], lat: c.point.coordinates[1], image: c.camera_url.url.replace(/^http:/, "https:") }),
      );
    }, StoredWebcams),
};

// ── Oregon ────────────────────────────────────────────────────────

const OREGON: Operator = { provider: "oregon", providerName: "Oregon DOT TripCheck", kind: "traffic", license: "Oregon Department of Transportation, TripCheck", refreshS: 300 };
const OregonCameras = z.object({
  features: z.array(z.object({ attributes: z.object({ cameraId: z.number(), filename: z.string(), latitude: z.number(), longitude: z.number(), title: z.string() }) })),
});

const oregon: ListedProvider = {
  id: "oregon",
  name: "Oregon DOT TripCheck",
  cities: [{ name: "Portland", lat: 45.5152, lon: -122.6784 }, { name: "Eugene", lat: 44.0521, lon: -123.0868 }],
  bbox: [41.9, -124.7, 46.4, -116.4],
  load: () =>
    diskMemo("webcams-v2-oregon", DAY, async () => {
      const data = await fetchJson("Oregon TripCheck", "https://tripcheck.com/Scripts/map/data/cctvinventory.js", OregonCameras, { timeoutMs: 30_000, headers: HEADERS });
      return data.features.flatMap(({ attributes: c }) =>
        webcam(OREGON, { id: String(c.cameraId), name: c.title, lat: c.latitude, lon: c.longitude, image: `https://tripcheck.com/RoadCams/cams/${encodeURIComponent(c.filename)}` }),
      );
    }, StoredWebcams),
};

// ── Colorado ──────────────────────────────────────────────────────

const COLORADO: Operator = { provider: "colorado", providerName: "Colorado DOT COtrip", kind: "traffic", license: "Colorado Department of Transportation, COtrip", refreshS: 120 };
const ColoradoCameras = z.array(
  z.object({
    id: z.number(),
    public: z.boolean(),
    active: z.boolean(),
    name: z.string(),
    location: z.object({ latitude: z.number(), longitude: z.number() }),
    views: z.array(z.object({ videoPreviewUrl: z.string().optional() })),
  }),
);

const colorado: ListedProvider = {
  id: "colorado",
  name: "Colorado DOT COtrip",
  cities: [{ name: "Denver", lat: 39.7392, lon: -104.9903 }, { name: "Colorado Springs", lat: 38.8339, lon: -104.8214 }],
  bbox: [36.9, -109.1, 41.1, -102],
  load: () =>
    diskMemo("webcams-v2-colorado", DAY, async () => {
      const data = await fetchJson("COtrip", "https://cotg.carsprogram.org/cameras_v1/api/cameras", ColoradoCameras, { timeoutMs: 45_000, headers: HEADERS });
      return data.flatMap((c) => {
        const image = c.views.find((v) => v.videoPreviewUrl)?.videoPreviewUrl;
        if (!c.public || !c.active || !image) return [];
        return webcam(COLORADO, { id: String(c.id), name: c.name, lat: c.location.latitude, lon: c.location.longitude, image });
      });
    }, StoredWebcams),
};

// ── Iceland ───────────────────────────────────────────────────────

const ICELAND: Operator = { provider: "is", providerName: "Icelandic Road Administration", kind: "weather", license: "Vegagerðin, Icelandic Road and Coastal Administration", refreshS: 300 };
const IcelandCameras = z.array(
  z.object({
    Myndavel: z.string(),
    Vegheiti: z.string().nullable(),
    Skyring: z.string().default(""),
    Slod: z.string(),
    Breidd: z.number(),
    Lengd: z.number(),
  }),
);

const iceland: ListedProvider = {
  id: "is",
  name: "Icelandic Road Administration",
  cities: [{ name: "Reykjavík", lat: 64.1466, lon: -21.9426 }],
  bbox: [63.2, -24.6, 66.6, -13.4],
  load: () =>
    diskMemo("webcams-v2-is", DAY, async () => {
      const data = await fetchJson("Vegagerðin", "https://gagnaveita.vegagerdin.is/api/vefmyndavelar2014_1", IcelandCameras, { timeoutMs: 30_000, headers: HEADERS });
      return data.flatMap((c) => webcam(ICELAND, { id: c.Slod.split("/").pop()?.replace(/\.jpe?g$/i, "") ?? c.Myndavel, name: [c.Myndavel, c.Vegheiti].filter(Boolean).join(" · "), lat: c.Breidd, lon: c.Lengd, image: c.Slod, direction: c.Skyring }));
    }, StoredWebcams),
};

// ── Europe ────────────────────────────────────────────────────────

const decodeXml = (s: string): string => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// A22 Brenner motorway (Italy), listed by the South Tyrol Open Data Hub.
const A22: Operator = { provider: "a22", providerName: "Autostrada del Brennero (A22)", kind: "traffic", license: "Autostrada del Brennero S.p.A., listed by the South Tyrol Open Data Hub", refreshS: 300 };
const A22Cameras = z.object({
  Items: z.array(
    z.object({
      Shortname: z.string().nullable(),
      Webcamurl: z.string().nullable(),
      GpsInfo: z.array(z.object({ Latitude: z.number(), Longitude: z.number() })),
    }),
  ),
});

const brenner: ListedProvider = {
  id: "a22",
  name: "Autostrada del Brennero (A22)",
  cities: [
    { name: "Bolzano", lat: 46.4983, lon: 11.3548 },
    { name: "Trento", lat: 46.0748, lon: 11.1217 },
    { name: "Verona", lat: 45.4384, lon: 10.9916 },
  ],
  bbox: [44.6, 10.7, 47.1, 11.6],
  load: () =>
    diskMemo("webcams-v2-a22", DAY, async () => {
      const data = await fetchJson("South Tyrol Open Data Hub", "https://tourism.opendatahub.com/v1/WebcamInfo?pagesize=100&active=true&source=a22", A22Cameras, { headers: HEADERS });
      return data.Items.flatMap((c) => {
        const gps = c.GpsInfo[0];
        const image = c.Webcamurl;
        if (!gps || !image?.startsWith("https://www.autobrennero.it/WebCamImg/")) return [];
        return webcam(A22, { id: image.split("/").pop()?.replace(/\.jpe?g$/i, "") ?? image, name: c.Shortname ? `A22 · ${c.Shortname}` : "A22", lat: gps.Latitude, lon: gps.Longitude, image });
      });
    }, StoredWebcams),
};

// Madrid city traffic cameras, published as a KML file by the city.
const MADRID: Operator = { provider: "madrid", providerName: "Ayuntamiento de Madrid", kind: "traffic", license: "Ayuntamiento de Madrid, datos abiertos", refreshS: 120 };

const madrid: ListedProvider = {
  id: "madrid",
  name: "Ayuntamiento de Madrid",
  cities: [{ name: "Madrid", lat: 40.4168, lon: -3.7038 }],
  bbox: [40.3, -3.9, 40.65, -3.5],
  load: () =>
    diskMemo("webcams-v2-madrid", DAY, async () => {
      const res = await fetchUpstream("Madrid traffic cameras", "https://informo.madrid.es/informo/tmadrid/CCTV.kml", { headers: HEADERS, timeoutMs: 30_000 });
      const kml = await res.text();
      return [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].flatMap((m) => {
        const block = m[1] ?? "";
        const number = block.match(/<Data name="Numero">\s*<Value>(\d+)<\/Value>/)?.[1];
        const name = block.match(/<Data name="Nombre">\s*<Value>([^<]*)<\/Value>/)?.[1];
        const [lon = Number.NaN, lat = Number.NaN] = (block.match(/<coordinates>\s*([^<]*?)\s*<\/coordinates>/)?.[1] ?? "").split(",").map(Number.parseFloat);
        if (!number || !name) return [];
        return webcam(MADRID, { id: number, name: titleCase(decodeXml(name)), lat, lon, image: `https://informo.madrid.es/cameras/Camara${number}.jpg` });
      });
    }, StoredWebcams),
};

// Catalonia: the Servei Català de Trànsit's open WFS feed lists its own cameras and those of Barcelona and Terrassa.
const CATALAN: Record<string, Operator> = {
  SCT: { provider: "cat", providerName: "Servei Català de Trànsit", kind: "traffic", license: "Servei Català de Trànsit, Generalitat de Catalunya, open data", refreshS: 300 },
  IMI: { provider: "bcn", providerName: "Barcelona mobility", kind: "traffic", license: "Ajuntament de Barcelona, open data", refreshS: 300 },
  Terrassa: { provider: "terrassa", providerName: "Ajuntament de Terrassa", kind: "traffic", license: "Ajuntament de Terrassa, open data", refreshS: 300 },
};

const catalonia: ListedProvider = {
  id: "cat",
  name: "Catalan traffic cameras",
  cities: [
    { name: "Barcelona", lat: 41.3874, lon: 2.1686 },
    { name: "Girona", lat: 41.9794, lon: 2.8214 },
    { name: "Tarragona", lat: 41.1189, lon: 1.2445 },
    { name: "Lleida", lat: 41.6176, lon: 0.62 },
  ],
  bbox: [40.5, 0.15, 42.9, 3.35],
  load: () =>
    diskMemo("webcams-v3-cat", DAY, async () => {
      const res = await fetchUpstream("Servei Català de Trànsit", "https://www.gencat.cat/transit/opendata/cameres.xml", { headers: HEADERS, timeoutMs: 30_000 });
      const xml = await res.text();
      const tag = (block: string, name: string): string => block.match(new RegExp(`<cite:${name}>([^<]*)</cite:${name}>`))?.[1]?.trim() ?? "";
      const seen = new Set<string>();
      return [...xml.matchAll(/<gml:featureMember>([\s\S]*?)<\/gml:featureMember>/g)].flatMap((m) => {
        const block = m[1] ?? "";
        const operator = CATALAN[tag(block, "font")];
        const link = tag(block, "link").split(/\s/)[0] ?? "";
        const id = link.match(/sctidcam=([\w-]+)/)?.[1] ?? link.split("/").pop()?.split("?")[0]?.replace(/\.\w+$/, "");
        // The feed repeats some cameras; the same operator and id is one camera.
        if (!operator || !id || !link.startsWith("http") || seen.has(`${operator.provider}:${id}`)) return [];
        seen.add(`${operator.provider}:${id}`);
        const [lon = Number.NaN, lat = Number.NaN] = (block.match(/<gml:coordinates[^>]*>([^<]*)<\/gml:coordinates>/)?.[1] ?? "").split(",").map(Number.parseFloat);
        const pk = tag(block, "pk");
        const place = [tag(block, "carretera"), tag(block, "municipi"), pk && `km ${pk}`].filter(Boolean).join(" · ");
        return webcam(operator, { id, name: place || id, lat, lon, image: link.replace(/^http:/, "https:") });
      });
    }, StoredWebcams),
};

export const streetProviders: ListedProvider[] = [tfl, caltrans, singapore, hongKong, finland, newZealand, britishColumbia, toronto, calgary, oregon, colorado, iceland, brenner, madrid, catalonia];
