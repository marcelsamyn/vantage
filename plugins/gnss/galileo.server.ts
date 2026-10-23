import type { GalileoNotice, GalileoSatellite, SatelliteHealth } from "./types";

/** The service centre publishes HTML and RSS only, so these read exactly the markup that the live pages use. */

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#039;": "'", "&#39;": "'", "&nbsp;": " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#0?39|nbsp);/g, (m) => ENTITIES[m] ?? m);
}

const stripTags = (html: string): string => decodeEntities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Wording from the table's own footnote 4. */
function healthOf(status: string): SatelliteHealth {
  switch (status.toUpperCase()) {
    case "USABLE":
      return "healthy";
    case "TESTING":
    case "UNDER COMMISSIONING":
      return "testing";
    case "NOT USABLE":
    case "NOT AVAILABLE":
      return "unhealthy";
    default:
      return "unknown";
  }
}

export function parseGalileoTable(html: string): GalileoSatellite[] {
  const table = html.match(/<table[\s\S]*?<\/table>/)?.[0] ?? "";
  const rows = table.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const out: GalileoSatellite[] = [];
  for (const row of rows.slice(1)) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map(stripTags);
    const [name, svid, clock, statusText, nagu, , subject] = cells;
    if (!name || !svid || !clock || !statusText) continue;
    out.push({ name, svid, clock, health: healthOf(statusText), statusText, nagu: nagu || null, subject: subject || null });
  }
  return out;
}

/** Reads "KEY: value" lines from a notice body, whose lines are separated by <br>. */
function field(body: string, key: string): string | null {
  const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m?.[1]?.trim() ?? null;
}

/** Notices that have no end yet carry the placeholder 2000-01-01, which is before Galileo's first service. */
const NO_DATE_BEFORE_MS = Date.parse("2010-01-01T00:00:00Z");

function utc(text: string | null): number | null {
  if (!text) return null;
  const ms = Date.parse(`${text.replace(" ", "T")}:00Z`);
  return Number.isNaN(ms) || ms < NO_DATE_BEFORE_MS ? null : Math.floor(ms / 1000);
}

export function parseGalileoNotices(rss: string): GalileoNotice[] {
  const out: GalileoNotice[] = [];
  for (const item of rss.match(/<item>[\s\S]*?<\/item>/g) ?? []) {
    const title = item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
    const id = title.match(/NAGU\)\s*(\d+)/)?.[1];
    const url = item.match(/<link>([\s\S]*?)<\/link>/)?.[1]?.trim();
    const pub = Date.parse(item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "");
    // Notices link to the service centre's own pages; anything else in the feed is not shown.
    if (!id || !url?.startsWith("https://www.gsc-europa.eu/") || Number.isNaN(pub)) continue;
    const description = item.match(/<description>([\s\S]*?)<\/description>/)?.[1] ?? "";
    // The description is escaped HTML: decode once, turn <br> and paragraph ends into line breaks, then drop the tags.
    const body = decodeEntities(description)
      .replace(/<br\s*\/?>|<\/p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((l) => decodeEntities(l).trim())
      .join("\n");
    out.push({
      id,
      subject: field(body, "NAGU SUBJECT") ?? title.trim(),
      type: field(body, "NAGU TYPE"),
      published: Math.floor(pub / 1000),
      start: utc(field(body, "START DATE EVENT \\(UTC\\)")),
      end: utc(field(body, "END DATE EVENT \\(UTC\\)")),
      affected: field(body, "SATELLITE AFFECTED"),
      url,
    });
  }
  return out;
}
