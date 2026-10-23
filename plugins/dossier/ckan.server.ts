import { HttpError, diskMemo, fetchJson, fetchPublic, z } from "../../server/kit";

/** Roma Capitale's open data portal (CKAN). Datasets there hold one file per publication date, so the newest file has to be looked up. */

const API = "https://dati.comune.roma.it/catalog/api/3/action/package_show";
const HOST = "dati.comune.roma.it";
const DAY_MS = 24 * 3_600_000;
const MAX_BYTES = 24 * 1024 * 1024;

const Package = z.object({
  result: z.object({
    resources: z.array(z.object({ name: z.string().nullish(), format: z.string().nullish(), url: z.string(), last_modified: z.string().nullish() })),
  }),
});

const StoredResources = z.array(z.object({ name: z.string(), format: z.string(), url: z.string(), stamp: z.string().nullable() }));

export interface CkanResource {
  name: string;
  format: string;
  url: string;
  /** The "YYYYMMDD" date in the file's name, or the day it was last modified when the name has none. */
  stamp: string | null;
}

/** All files of a dataset, with the publication date read from the file name. */
export function ckanResources(datasetId: string): Promise<CkanResource[]> {
  return diskMemo(`dossier-ckan-${datasetId}`, DAY_MS, async () => {
    const url = new URL(API);
    url.searchParams.set("id", datasetId);
    const data = await fetchJson("Roma Capitale open data", url, Package);
    return data.result.resources.map((r) => ({
      name: r.name ?? "",
      format: (r.format ?? "").toUpperCase(),
      url: r.url,
      stamp: /(?:^|\D)(20\d{6})(?:\D|$)/.exec(r.name ?? "")?.[1] ?? /\/download\/(20\d{6})/.exec(r.url)?.[1] ?? r.last_modified?.slice(0, 10).replaceAll("-", "") ?? null,
    }));
  }, StoredResources);
}

/** The newest file of a dataset that matches, by the date in its name. */
export async function newestResource(datasetId: string, wanted: (r: CkanResource) => boolean): Promise<CkanResource> {
  const hits = (await ckanResources(datasetId)).filter((r) => r.stamp && wanted(r)).sort((a, b) => (b.stamp ?? "").localeCompare(a.stamp ?? ""));
  const newest = hits[0];
  if (!newest) throw new HttpError(502, "upstream_shape", `Roma Capitale open data has no matching file in dataset ${datasetId}`);
  return newest;
}

/** "20260723" becomes "2026-07-23". */
export const isoDate = (stamp: string): string => `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;

/** Download a file the portal lists. The URL came from a third party, so it must stay on the portal's own host and on the public internet. */
export async function downloadRomeFile(resource: CkanResource): Promise<ArrayBuffer> {
  if (new URL(resource.url).hostname !== HOST) throw new HttpError(502, "bad_host", `Roma Capitale open data listed a file on ${new URL(resource.url).hostname}, which VANTAGE does not open`);
  const res = await fetchPublic("Roma Capitale open data", resource.url, { timeoutMs: 60_000, headers: { accept: "*/*" } });
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) throw new HttpError(502, "too_large", `${resource.name} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new HttpError(502, "too_large", `${resource.name} is larger than ${MAX_BYTES / 1024 / 1024} MB`);
  return bytes;
}
