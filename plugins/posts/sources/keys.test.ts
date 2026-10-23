import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { HttpError, z } from "../../../server/kit";
import { sourceStatuses } from "../api";
import { fetchKeyed, rateGate, redact, withoutKey } from "./source.server";

const KEY = "AIzaSy-secret/key+with=odd&chars";

/** A stand-in for `fetch`: the handler plus Bun's `preconnect`, so it has fetch's full type. */
const fakeFetch = (handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => Object.assign(handler, { preconnect: fetch.preconnect });

describe("keeping keys out of messages", () => {
  test("redacts the key in plain and URL-encoded form", () => {
    const url = `https://example.org/x?api_key=${encodeURIComponent(KEY)}`;
    expect(redact(`failed: ${url} (${KEY})`, KEY)).toBe("failed: https://example.org/x?api_key=[key] ([key])");
  });

  test("redacts the key as a query string writes it, where a space is '+' and '~!()' are escaped", () => {
    const odd = "k ey~!(x)";
    const query = new URLSearchParams({ api_key: odd }).toString();
    expect(query).not.toContain(encodeURIComponent(odd));
    expect(redact(`GET https://example.org/?${query}`, odd)).toBe("GET https://example.org/?api_key=[key]");
  });

  test("an upstream error keeps its status and code, and loses the key", () => {
    const err = withoutKey(new HttpError(504, "upstream_unreachable", `YouTube is unreachable: GET https://x/?key=${KEY}`), KEY);
    expect(err.status).toBe(504);
    expect(err.code).toBe("upstream_unreachable");
    expect(err.message).not.toContain(KEY);
  });

  test("a network failure whose message repeats the request URL reaches the browser without the key", async () => {
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      fakeFetch(async (input) => {
        throw new TypeError(`fetch failed for ${String(input)}`);
      }),
    );
    try {
      const url = new URL(`https://api.example.org/search?api_key=${encodeURIComponent(KEY)}`);
      const failure = await fetchKeyed("Example", url, z.object({}), KEY).catch((err: unknown) => err);
      if (!(failure instanceof HttpError)) throw new Error("expected an HttpError");
      expect(failure.message).toContain("api.example.org");
      expect(failure.message).not.toContain(KEY);
      expect(failure.message).not.toContain(encodeURIComponent(KEY));
    } finally {
      spy.mockRestore();
    }
  });
});

describe("the sources status", () => {
  afterEach(() => {
    delete process.env["VANTAGE_YOUTUBE_KEY"];
    delete process.env["VANTAGE_FLICKR_KEY"];
  });

  test("says which optional sources have a key, and never carries the key", () => {
    expect(sourceStatuses().map((s) => [s.id, s.configured])).toEqual([
      ["inaturalist", true],
      ["fixmystreet", true],
      ["youtube", false],
      ["flickr", false],
    ]);
    process.env["VANTAGE_YOUTUBE_KEY"] = KEY;
    process.env["VANTAGE_FLICKR_KEY"] = "flickr-0123456789abcdef";
    const status = sourceStatuses();
    expect(status.every((s) => s.configured)).toBe(true);
    const body = JSON.stringify(status);
    expect(body).not.toContain(KEY);
    expect(body).not.toContain("flickr-0123456789abcdef");
  });
});

describe("the request cap", () => {
  test("refuses requests above the cap until a minute has passed", () => {
    let now = 0;
    const gate = rateGate("Example", 3, () => now);
    gate();
    gate();
    gate();
    expect(() => gate()).toThrow("VANTAGE keeps Example to 3 requests a minute");
    now = 60_000;
    expect(() => gate()).not.toThrow();
  });
});
