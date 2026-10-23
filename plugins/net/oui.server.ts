import { HttpError, describe, diskMemo, fetchUpstream, log, z } from "../../server/kit";

/** Maker lookup from a MAC address, using the Wireshark manufacturer list (IEEE registry), refreshed monthly. */

const OUI_URL = "https://www.wireshark.org/download/automated/data/manuf";
const MONTH_MS = 30 * 24 * 3600_000;

/** Prefix (hex digits, lowercase, no separators) → vendor. Registry blocks are 24, 28 or 36 bits wide. */
type OuiTable = Record<string, string>;

/** Drop corporate suffixes so "Amazon Technologies Inc." reads "Amazon Technologies". */
function tidyVendor(name: string): string {
  return name
    .replace(/[,\s]+(inc|incorporated|corp|corporation|co|ltd|llc|gmbh|s\.?a\.?|b\.?v\.?|ag|oy|ab|plc|limited|company)\.?(?=[,\s.]|$)/gi, "")
    .replace(/[\s,.]+$/, "")
    .trim();
}

export function parseOui(text: string): OuiTable {
  const table: OuiTable = {};
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [prefix, short, full] = line.split("\t");
    if (!prefix || !short) continue;
    const [addr = "", bitsText] = prefix.trim().split("/");
    const hex = addr.replace(/[:.-]/g, "").toLowerCase();
    const bits = bitsText ? Number(bitsText) : hex.length * 4;
    if (bits % 4 !== 0 || !/^[0-9a-f]+$/.test(hex) || ![24, 28, 36].includes(bits)) continue;
    const key = hex.slice(0, bits / 4);
    const name = tidyVendor((full ?? short).trim());
    if (name) table[key] = name;
  }
  return table;
}

const StoredTable = z.record(z.string(), z.string());

function loadTable(): Promise<OuiTable> {
  return diskMemo("net-oui", MONTH_MS, async () => {
    const res = await fetchUpstream("Wireshark manufacturer list", OUI_URL, { timeoutMs: 60_000, headers: { accept: "text/plain" } });
    const table = parseOui(await res.text());
    if (Object.keys(table).length < 10_000) throw new HttpError(502, "upstream_shape", "Wireshark manufacturer list sent too few entries to be the registry");
    return table;
  }, StoredTable);
}

/** Vendors for MAC addresses like "ec:b5:fa:07:86:f2". A failed download leaves every vendor null instead of failing the device list. */
export async function vendorsOf(macs: string[]): Promise<Map<string, string | null>> {
  const table = await loadTable().catch((err: unknown) => {
    log.warn("vendor list unavailable", { error: describe(err) });
    return null;
  });
  const out = new Map<string, string | null>();
  for (const mac of macs) {
    const hex = mac.replace(/[:.-]/g, "").toLowerCase();
    out.set(mac, table ? (table[hex.slice(0, 9)] ?? table[hex.slice(0, 7)] ?? table[hex.slice(0, 6)] ?? null) : null);
  }
  return out;
}
