import { afterEach, expect, test } from "bun:test";
import type { BunRequest } from "bun";
import { RadarResponse, radarEvents } from "./api";
import { outageThings } from "./things";
import { HttpError } from "../../server/kit";

const annotation = {
  id: "record-1", asns: [64500], asnsDetails: [{ asn: "64500", name: null, location: null }], dataSource: "HTTP", description: null,
  startDate: "2026-10-11T01:00:00Z", endDate: null, entities: [{ entityName: null, entityType: "ASN", entityValue: "64500" }],
  eventType: "OUTAGE", geoIds: ["2264397"], linkedUrl: "javascript:alert(1)", locations: ["PT", "ZZ"], locationsDetails: [null],
  origins: [], originsDetails: [], outage: { outageCause: "POWER_OUTAGE", outageType: "NETWORK" }, scope: null, tags: ["ASN"],
};
test("nullable metadata is accepted, unsafe source links are removed, and network scope is retained", () => {
  const [event] = radarEvents(RadarResponse.parse({ success: true, result: { annotations: [annotation] } }));
  expect(event).toMatchObject({ scope: null, linkedUrl: null, endDate: null, outage: { outageType: "NETWORK" } });
  if (!event) throw new Error("Expected a radar event");
  const things = outageThings(event);
  expect(things).toHaveLength(1);
  expect(things[0]?.rows?.[0]?.[1]).toContain("reference point");
  expect(things[0]?.detail).toBe("Portugal · NETWORK");
  expect(things[0]?.state).toBe("unknown");
});
test("ended events remain distinguishable and failed envelopes are actionable", () => {
  const [event] = radarEvents(RadarResponse.parse({ success: true, result: { annotations: [{ ...annotation, endDate: "2026-10-11T02:00:00Z" }] } }));
  expect(event && outageThings(event)[0]?.rows?.[1]?.[1]).toStartWith("Ended");
  expect(() => radarEvents({ success: false })).toThrow(HttpError);
  expect(RadarResponse.safeParse({ success: true, result: { annotations: [{ ...annotation, startDate: "yesterday" }] } }).success).toBe(false);
});
const oldToken = process.env.VANTAGE_CLOUDFLARE_TOKEN;
afterEach(() => { if (oldToken === undefined) delete process.env.VANTAGE_CLOUDFLARE_TOKEN; else process.env.VANTAGE_CLOUDFLARE_TOKEN = oldToken; });
test("missing token cannot be mistaken for an empty outage report", async () => {
  delete process.env.VANTAGE_CLOUDFLARE_TOKEN;
  const source = (await import("./api")).default;
  const handler = source.routes["GET /events"];
  if (!handler) throw new Error("Missing events route");
  await expect(handler(new Request("http://localhost/api/outages/events") as BunRequest<string>)).rejects.toMatchObject({ status: 503, code: "needs_key" });
});
