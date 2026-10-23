import { defineSource, HttpError, json, memo, webUrl, z } from "../../server/kit";
import { fetchKeyed } from "../posts/sources/source.server";
import type { Outage, OutageReport } from "./types";

const Location = z.object({ code: z.string(), name: z.string() });
const Annotation = z.object({
  id: z.string(), description: z.string().nullable(), startDate: z.iso.datetime({ offset: true }), endDate: z.iso.datetime({ offset: true }).nullable(),
  eventType: z.string(), dataSource: z.string(), scope: z.string().nullable(),
  outage: z.object({ outageCause: z.string(), outageType: z.string() }).nullable(),
  asns: z.array(z.number()), asnsDetails: z.array(z.object({ asn: z.string(), name: z.string().nullable(), location: Location.nullable() })),
  entities: z.array(z.object({ entityName: z.string().nullable(), entityType: z.string(), entityValue: z.string() })),
  geoIds: z.array(z.string()), locations: z.array(z.string()), locationsDetails: z.array(Location.nullable()),
  origins: z.array(z.string()), originsDetails: z.array(z.object({ name: z.string().nullable(), origin: z.string() })),
  linkedUrl: z.string().nullable(), tags: z.array(z.string()),
});
export const RadarResponse = z.object({ success: z.boolean(), result: z.object({ annotations: z.array(Annotation) }).optional() });

export function radarEvents(response: z.infer<typeof RadarResponse>): Outage[] {
  if (!response.success || !response.result) throw new HttpError(502, "radar_failed", "Cloudflare Radar could not return outages. Check the token's Radar permissions.");
  return response.result.annotations.map((event) => ({ ...event, linkedUrl: webUrl(event.linkedUrl) }));
}

async function load(): Promise<OutageReport> {
  const key = process.env.VANTAGE_CLOUDFLARE_TOKEN;
  if (!key) throw new HttpError(503, "needs_key", "Set VANTAGE_CLOUDFLARE_TOKEN to a token with Account → Radar → Read permission, then restart VANTAGE.");
  return memo("outages.radar", 5 * 60_000, async () => {
    const events: Outage[] = [];
    for (let page = 0; page < 10; page++) {
      const url = new URL("https://api.cloudflare.com/client/v4/radar/annotations/outages");
      url.search = new URLSearchParams({ dateRange: "7d", limit: "100", offset: String(page * 100), format: "JSON" }).toString();
      const rows = radarEvents(await fetchKeyed("Cloudflare Radar", url, RadarResponse, key, { redirect: "error", headers: { authorization: `Bearer ${key}` } }));
      events.push(...rows);
      if (rows.length < 100) return { fetchedAt: Date.now(), events, capped: false };
    }
    return { fetchedAt: Date.now(), events, capped: true };
  }, 5 * 60_000);
}

export default defineSource({ routes: { "GET /events": async () => json(await load()) } });
