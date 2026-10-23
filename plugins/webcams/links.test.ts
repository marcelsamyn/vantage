import { describe, expect, test } from "bun:test";
import type { OsmElement } from "../grid/overpass.server";
import { osmCameras, pageLinks } from "./directories.server";
import { limiter, pageFacts, pictureAge, ruleFor, webLink, type LinkedPicture } from "./links.server";

describe("webLink", () => {
  test("adds the scheme mappers leave out and refuses what is not a web address", () => {
    expect(webLink(" backend.roundshot.com/cams/44/full ")).toBe("https://backend.roundshot.com/cams/44/full");
    expect(webLink("http://www.balisemeteo.com/balise_mob.php?idBalise=10")).toBe("http://www.balisemeteo.com/balise_mob.php?idBalise=10");
    for (const value of ["unknown", "", "javascript:alert(1)", "ftp://cams.example.org/a.jpg", "two words.com"]) expect(webLink(value)).toBeNull();
  });

  test("leaves out cameras reached by a bare IP address", () => {
    for (const value of ["http://66.241.67.14:80/jpeg", "http://61.115.112.112/nphMotionJpeg?Resolution=320x240", "http://[2001:db8::1]/snap.jpg"]) expect(webLink(value)).toBeNull();
  });
});

describe("ruleFor", () => {
  const platform = (link: string): string | null => {
    const found = ruleFor(link);
    return found === null ? null : found === "preview" ? "preview" : found.rule.platform;
  };

  test("follows the platform rules recorded from OpenStreetMap's links", () => {
    expect(platform("https://apps.usgs.gov/hivis/camera/AK_Alsek_River_at_Dry_Bay_near_Yakutat")).toBe("USGS river cameras");
    expect(platform("https://youtu.be/3ZdNaAXAWq4")).toBe("YouTube");
    expect(platform("https://www.youtube.com/watch?feature=share&v=3ZdNaAXAWq4")).toBe("YouTube");
    expect(platform("https://g0.ipcamlive.com/player/player.php?alias=5b72c96b08c8c&autoplay=1")).toBe("IPCamLive");
    expect(platform("http://webtv.feratel.com/webtv/?design=v3&cam=3115&getLatest=1")).toBe("Feratel");
    expect(platform("https://nps.gov/media/webcam/view.htm?id=3F33B673")).toBe("US National Park Service");
  });

  test("builds the picture address from the link", async () => {
    const found = ruleFor("https://apps.usgs.gov/hivis/camera/AK_Alsek_River");
    if (found === null || found === "preview") throw new Error("expected a rule");
    expect(await found.rule.find(new URL("https://apps.usgs.gov/hivis/camera/AK_Alsek_River"), found.m)).toEqual({
      image: "https://usgs-nims-images.s3.amazonaws.com/overlay/AK_Alsek_River/AK_Alsek_River_newest.jpg",
      title: "AK Alsek River",
    });
  });

  test("reads other pages for their preview, and leaves alone sites that are no camera or already a provider", () => {
    expect(platform("https://www.foto-webcam.eu/webcam/adlersruhe/")).toBe("preview");
    expect(platform("https://ctroads.org/map/Cctv/308")).toBe("preview");
    for (const link of ["https://pioupiou.com/fr/100", "https://de.webcams.travel/webcam/1392711606", "https://www.youtube.com/@somechannel", "https://udottraffic.utah.gov/map/Cctv/10013"]) {
      expect(platform(link)).toBeNull();
    }
  });
});

describe("pageFacts", () => {
  test("finds the preview picture and title in either attribute order, against the page's address", () => {
    const html = `<head><title>ignored</title><meta content="/webcam/adlersruhe/current/1200.jpg" property="og:image"><meta property="og:title" content="Adlersruhe &amp; Wildspitze"></head>`;
    expect(pageFacts(html, "https://www.foto-webcam.eu/webcam/adlersruhe/")).toEqual({ image: "https://www.foto-webcam.eu/webcam/adlersruhe/current/1200.jpg", title: "Adlersruhe & Wildspitze" });
  });

  test("falls back to the Twitter picture and the page title, and refuses a picture that is not a web address", () => {
    expect(pageFacts(`<meta name="twitter:image" content="//wtvthmb.feratel.com/thumbnails/3115.jpeg"><title> Hintertux \n Glacier </title>`, "http://webtv.feratel.com/webtv/")).toEqual({ image: "http://wtvthmb.feratel.com/thumbnails/3115.jpeg", title: "Hintertux Glacier" });
    expect(pageFacts(`<meta property="og:image" content="data:image/gif;base64,R0lGOD">`, "https://example.org/").image).toBeNull();
  });
});

describe("pictureAge", () => {
  const NOW = Date.parse("2026-10-10T12:00:00Z");
  test("a picture from the last two days is live; an older one belongs to a camera that stopped", () => {
    expect(pictureAge("Sat, 10 Oct 2026 11:50:00 GMT", NOW)).toBe(Date.parse("2026-10-10T11:50:00Z"));
    expect(pictureAge("Fri, 16 May 2025 02:00:59 GMT", NOW)).toBe("stale");
    expect(pictureAge(null, NOW)).toBeNull();
    expect(pictureAge("not a date", NOW)).toBeNull();
    expect(pictureAge("Sun, 11 Oct 2026 12:00:00 GMT", NOW)).toBeNull();
  });
});

describe("cameras behind page links", () => {
  const node = (id: number, tags: Record<string, string>): OsmElement => ({ type: "node", id, lat: 47.2, lon: 11.4, tags });
  const elements = [
    node(1, { "contact:webcam": "https://www.foto-webcam.eu/webcam/adlersruhe/" }),
    node(2, { "contact:webcam": "https://cams.example.org/now.jpg;https://cams.example.org/page" }),
    node(3, { "contact:webcam": "https://dead.example.org/cam", name: "Old camera" }),
    node(4, { "contact:webcam": "https://cameras.santoandre.sp.gov.br/coi02/ID_065", "surveillance:zone": "traffic" }),
  ];
  const pictures: Record<string, LinkedPicture> = {
    "https://www.foto-webcam.eu/webcam/adlersruhe/": { image: "https://www.foto-webcam.eu/webcam/adlersruhe/current/1200.jpg", stream: null, platform: "foto-webcam.eu", title: "Adlersruhe", refreshS: 600 },
    "https://cameras.santoandre.sp.gov.br/coi02/ID_065": { image: "https://cameras.santoandre.sp.gov.br/coi02/ID_065", stream: { type: "mjpeg", url: "https://cameras.santoandre.sp.gov.br/coi02/ID_065" }, platform: "cameras.santoandre.sp.gov.br", title: null, refreshS: 300 },
  };

  test("only cameras without a direct picture need their pages read", () => {
    expect(pageLinks(elements)).toEqual(["https://www.foto-webcam.eu/webcam/adlersruhe/", "https://dead.example.org/cam", "https://cameras.santoandre.sp.gov.br/coi02/ID_065"]);
  });

  test("a direct picture on a known platform carries the platform's name, as a found one does", () => {
    const [camera] = osmCameras([node(5, { "contact:webcam": "https://www.foto-webcam.eu/webcam/zugspitze/current/1200.jpg" })]);
    expect(camera).toMatchObject({ providerName: "foto-webcam.eu", refreshS: 600, name: "Camera of foto-webcam.eu" });
  });

  test("a found picture becomes a camera named by its page and linked to it; a page without one stays out", () => {
    const cameras = osmCameras(elements, pictures);
    expect(cameras.map((c) => c.id)).toEqual(["osm:node/1", "osm:node/2", "osm:node/4"]);
    expect(cameras[0]).toMatchObject({ name: "Adlersruhe", providerName: "foto-webcam.eu", refreshS: 600, page: "https://www.foto-webcam.eu/webcam/adlersruhe/", license: "Camera mapped by OpenStreetMap contributors (ODbL). Picture: foto-webcam.eu" });
    const [operated] = osmCameras([node(6, { "contact:webcam": "https://www.foto-webcam.eu/webcam/adlersruhe/", operator: "Alpenverein" })], pictures);
    expect(operated).toMatchObject({ providerName: "Alpenverein", license: "Camera mapped by OpenStreetMap contributors (ODbL). Picture: Alpenverein on foto-webcam.eu" });
    expect(cameras[1]).toMatchObject({ image: "https://cams.example.org/now.jpg", page: "https://www.openstreetmap.org/node/2" });
    expect(cameras[2]).toMatchObject({ kind: "traffic", name: "Camera of cameras.santoandre.sp.gov.br", stream: { type: "mjpeg" } });
  });
});

describe("limiter", () => {
  const gate = (): { promise: Promise<void>; open: () => void } => {
    let open = (): void => undefined;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
  };

  test("keeps to both limits, lets another site past a busy one, and frees a place when a task fails", async () => {
    const run = limiter(3, 2);
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof gate>>();
    const task = (key: string, name: string, fail = false) =>
      run(key, async () => {
        started.push(name);
        const g = gate();
        gates.set(name, g);
        await g.promise;
        if (fail) throw new Error(name);
        return name;
      });
    const a1 = task("a", "a1", true);
    const a2 = task("a", "a2");
    const a3 = task("a", "a3");
    const b1 = task("b", "b1");
    const b2 = task("b", "b2");
    await Bun.sleep(0);
    expect(started).toEqual(["a1", "a2", "b1"]);

    gates.get("a1")?.open();
    await expect(a1).rejects.toThrow("a1");
    await Bun.sleep(0);
    expect(started).toEqual(["a1", "a2", "b1", "a3"]);

    gates.get("b1")?.open();
    await Bun.sleep(0);
    expect(started).toEqual(["a1", "a2", "b1", "a3", "b2"]);
    for (const name of ["a2", "a3", "b2"]) gates.get(name)?.open();
    expect(await Promise.all([a2, a3, b1, b2])).toEqual(["a2", "a3", "b1", "b2"]);
  });
});
