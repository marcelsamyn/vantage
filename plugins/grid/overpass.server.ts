import { HttpError, fetchUpstream, parseUpstream, z } from "../../server/kit";

/**
 * OpenStreetMap queries through the public Overpass API.
 * Overpass gives each IP two concurrent slots, so requests queue here; a mirror takes over on failure.
 */

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const MAX_CONCURRENT = 2;

const OsmElement = z.object({
  type: z.enum(["node", "way", "relation"]),
  id: z.number(),
  lat: z.number().optional(),
  lon: z.number().optional(),
  center: z.object({ lat: z.number(), lon: z.number() }).optional(),
  geometry: z.array(z.object({ lat: z.number(), lon: z.number() }).nullable()).optional(),
  tags: z.record(z.string(), z.string()).default({}),
});
export type OsmElement = z.infer<typeof OsmElement>;
const OverpassResponse = z.object({ elements: z.array(OsmElement), remark: z.string().optional() });

/** When an endpoint failed recently, try the others first. */
const failedAt = new Map<string, number>();
const RECENT_MS = 3 * 60_000;
function endpointOrder(): string[] {
  const now = Date.now();
  return [...ENDPOINTS].sort((a, b) => Number(now - (failedAt.get(a) ?? 0) < RECENT_MS) - Number(now - (failedAt.get(b) ?? 0) < RECENT_MS));
}

let running = 0;
const waiting: (() => void)[] = [];

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await task();
  } finally {
    running--;
    waiting.shift()?.();
  }
}

/** Run an Overpass QL query (without the [out:json] header) and return its elements. */
export function overpass(body: string, timeoutS = 25): Promise<OsmElement[]> {
  const query = `[out:json][timeout:${timeoutS}];${body}`;
  return slot(async () => {
    let last: unknown;
    for (const endpoint of endpointOrder()) {
      try {
        const res = await fetchUpstream("OpenStreetMap (Overpass)", endpoint, {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          timeoutMs: (timeoutS + 5) * 1000,
        });
        const data = parseUpstream("OpenStreetMap (Overpass)", OverpassResponse, await res.json());
        if (data.remark?.includes("runtime error")) throw new HttpError(502, "upstream_status", `Overpass: ${data.remark}`);
        failedAt.delete(endpoint);
        return data.elements;
      } catch (err) {
        failedAt.set(endpoint, Date.now());
        last = err;
      }
    }
    throw last;
  });
}

/** Where an element sits: its own coordinates, or the centre Overpass computed for ways and relations. */
export function positionOf(el: OsmElement): { lat: number; lon: number } | null {
  if (el.lat !== undefined && el.lon !== undefined) return { lat: el.lat, lon: el.lon };
  return el.center ?? null;
}
