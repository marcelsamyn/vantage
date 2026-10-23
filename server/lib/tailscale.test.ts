import { describe, expect, setSystemTime, test } from "bun:test";
import { tailnetAccess, type Tailnet } from "./tailnet";
import { ServeConfig, serveUse } from "./tailscale";

const HOST = "mac.example-tailnet.ts.net";
const site = (handlers: Record<string, { Proxy?: string }>, funnel = false): ServeConfig =>
  ServeConfig.parse({ TCP: { "443": { HTTPS: true } }, Web: { [`${HOST}:443`]: { Handlers: handlers } }, ...(funnel ? { AllowFunnel: { [`${HOST}:443`]: true } } : {}) });

describe("what Serve shares at this Mac's name", () => {
  test("VANTAGE alone at / is the only state that allows remote access", () => {
    expect(serveUse(site({ "/": { Proxy: "http://127.0.0.1:4747" } }), HOST, 4747)).toEqual({ kind: "vantage" });
    expect(serveUse(site({ "/": { Proxy: "http://localhost:4747/" } }), HOST, 4747)).toEqual({ kind: "vantage" });
  });

  test("nothing shared, or another host only, is none", () => {
    expect(serveUse(ServeConfig.parse({}), HOST, 4747)).toEqual({ kind: "none" });
    expect(serveUse(ServeConfig.parse({ Web: { "other.example-tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:4747" } } } } }), HOST, 4747)).toEqual({ kind: "none" });
  });

  test("a second share on the same origin, another port at /, a folder, or Funnel turn it off", () => {
    expect(serveUse(site({ "/": { Proxy: "http://127.0.0.1:4747" }, "/files": {} }), HOST, 4747)).toEqual({ kind: "other", what: "a folder or text at /files" });
    expect(serveUse(site({ "/": { Proxy: "http://127.0.0.1:3000" } }), HOST, 4747)).toEqual({ kind: "other", what: "http://127.0.0.1:3000" });
    expect(serveUse(site({ "/": { Proxy: "http://127.0.0.1:4747" } }, true), HOST, 4747).kind).toBe("other");
    expect(serveUse(site({ "/": { Proxy: "http://192.168.1.5:4747" } }), HOST, 4747).kind).toBe("other");
  });
});

describe("reading the tailnet on demand", () => {
  const NET: Tailnet = { host: HOST, logins: new Set(["owner@example.org"]) };

  test("many requests at once share one read, and the answer holds for a minute", async () => {
    let reads = 0;
    const access = tailnetAccess(async () => {
      reads++;
      await Bun.sleep(5);
      return NET;
    });
    setSystemTime(new Date("2026-10-09T12:00:00Z"));
    expect(await Promise.all([access(), access(), access()])).toEqual([NET, NET, NET]);
    setSystemTime(new Date("2026-10-09T12:00:59Z"));
    await access();
    expect(reads).toBe(1);
    setSystemTime(new Date("2026-10-09T12:01:01Z"));
    await access();
    expect(reads).toBe(2);
    setSystemTime();
  });

  test("a closed answer (Tailscale off or sharing more than VANTAGE) is also held, so a flood spawns nothing", async () => {
    let reads = 0;
    const access = tailnetAccess(async () => {
      reads++;
      return null;
    });
    setSystemTime(new Date("2026-10-09T12:00:00Z"));
    for (let i = 0; i < 20; i++) expect(await access()).toBeNull();
    expect(reads).toBe(1);
    setSystemTime();
  });
});
