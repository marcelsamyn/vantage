import { describe, expect, test } from "bun:test";
import { catalog, covers, labelOf, listEras, tileAt, tileBounds, tileUrl, type EraDef } from "./catalog.server";

const NOW = new Date("2026-10-09T10:00:00Z");
const all = catalog(NOW);
const byId = (id: string): EraDef => {
  const def = all.find((d) => d.id === id);
  if (!def) throw new Error(`no era ${id}`);
  return def;
};

describe("catalog", () => {
  test("ids are unique", () => {
    expect(new Set(all.map((d) => d.id)).size).toBe(all.length);
  });

  test("every tile template can be filled for one tile", () => {
    for (const def of all) {
      const url = tileUrl(def.tiles, 14, 8361, 5481);
      expect(url, def.id).not.toMatch(/[{}]/);
      expect(url, def.id).toMatch(/^https?:\/\//);
    }
  });

  test("each era is viewed at a zoom its publisher serves", () => {
    for (const def of all) {
      expect(def.viewZoom, def.id).toBeGreaterThanOrEqual(def.minzoom);
      expect(def.viewZoom, def.id).toBeLessThanOrEqual(def.maxzoom);
    }
  });

  test("labels read 'year · name'", () => {
    expect(labelOf(byId("flanders.ferraris"))).toBe("1777 · Ferraris");
    expect(labelOf(byId("flanders.vandermaelen"))).toBe("1850 · Vandermaelen");
    expect(labelOf(byId("ign.1950"))).toBe("1950–65 · aerial");
  });

  test("yesterday's orbit view asks NASA for yesterday in UTC", () => {
    const def = byId("nasa.yesterday");
    expect(def.tiles).toContain("/default/2026-10-08/");
    expect(def.year).toBe(2026);
    expect(def.global).toBe(true);
  });

  test("NGI mosaics are fetched from the folder of their decade", () => {
    expect(byId("ngi.1971").tiles).toContain("/orthophotos_1970s/1.0.0/orthophoto_1971/");
    expect(byId("ngi.1948").tiles).toContain("/orthophotos_1940s/1.0.0/orthophoto_1948/");
  });
});

describe("tiles", () => {
  test("finds the tile that holds a point", () => {
    expect(tileAt(50.8467, 4.3525, 15)).toEqual({ x: 16780, y: 10992 });
    expect(tileAt(51.054, 3.722, 15)).toEqual({ x: 16722, y: 10962 });
  });

  test("WMS bounds match the tile in Web Mercator metres", () => {
    const [west, south, east, north] = tileBounds(15, 16780, 10992);
    expect(west).toBeCloseTo(484305.011215, 3);
    expect(south).toBeCloseTo(6593152.311766, 3);
    expect(east).toBeCloseTo(485528.003667, 3);
    expect(north).toBeCloseTo(6594375.304219, 3);
  });

  test("fills WMTS and WMS templates", () => {
    expect(tileUrl("https://x.test/{z}/{x}/{y}.png", 3, 4, 5)).toBe("https://x.test/3/4/5.png");
    expect(tileUrl("https://x.test/{z}/{y}/{x}.jpg", 3, 4, 5)).toBe("https://x.test/3/5/4.jpg");
    expect(tileUrl("https://x.test/wms?BBOX={bbox-epsg-3857}", 0, 0, 0)).toBe("https://x.test/wms?BBOX=-20037508.342789,-20037508.342789,20037508.342789,20037508.342789");
  });

  test("a point on a box edge counts as covered", () => {
    expect(covers([0, 0, 10, 10], 10, 0)).toBe(true);
    expect(covers([0, 0, 10, 10], 10.001, 0)).toBe(false);
  });
});

describe("listEras", () => {
  test("sorts oldest first, maps before photos within a year", () => {
    const list = listEras([byId("ngi.1971"), byId("flanders.ferraris"), byId("flanders.vandermaelen"), byId("nasa.yesterday"), byId("swisstopo.1970")]);
    expect(list.map((e) => e.label)).toEqual(["1777 · Ferraris", "1850 · Vandermaelen", "1970 · map", "1971 · aerial", "Yesterday · from orbit"]);
  });

  test("keeps the first publisher when two show the same survey", () => {
    const list = listEras([byId("flanders.ferraris"), byId("wallonia.ferraris"), byId("flanders.1971"), byId("ngi.1971")]);
    expect(list.map((e) => e.id)).toEqual(["flanders.ferraris", "flanders.1971"]);
  });

  test("keeps different surveys of one year apart", () => {
    const list = listEras([byId("swisstopo.1970"), byId("ngi.1970")]);
    expect(list.map((e) => e.kind)).toEqual(["map", "aerial"]);
  });

  test("does not leak server-only fields", () => {
    const [first] = listEras([byId("flanders.ferraris")]);
    expect(first).toBeDefined();
    expect(Object.keys(first ?? {})).not.toContain("bbox");
    expect(Object.keys(first ?? {})).not.toContain("blankMaxBytes");
  });
});
