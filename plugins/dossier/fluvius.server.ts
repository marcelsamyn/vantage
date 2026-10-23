import { diskMemo, fetchJson, memo, z } from "../../server/kit";
import type { LatLon } from "../../shared/geo";
import { inFlanders } from "./area.server";
import type { EnergyFuel, StreetEnergy } from "./types";

/**
 * Gas and electricity use per street in Flanders, from Fluvius open data (annual figures, latest full year).
 * A street with fewer than 10 connections is never shown, so a figure cannot point at one household.
 */

const DATASET = "https://opendata.fluvius.be/api/explore/v2.1/catalog/datasets/1_03-verbruiksgegevens-op-straatniveau/records";
const SOURCE = "Fluvius open data";
const MIN_CONNECTIONS = 10;
const DAY_MS = 24 * 3_600_000;

const StreetRows = z.object({
  results: z.array(
    z.object({
      verbruiksjaar: z.string(),
      energie: z.string(),
      richting: z.string(),
      aantal_toegangspunten: z.number(),
      afname_kwh: z.number(),
    }),
  ),
});

const MunicipalityRows = z.object({
  results: z.array(z.object({ energie: z.string(), kwh: z.number().nullable(), n: z.number().nullable() })),
});

const PhotonReverse = z.object({
  features: z.array(
    z.object({
      properties: z.object({
        name: z.string().optional(),
        street: z.string().optional(),
        type: z.string().optional(),
        county: z.string().optional(),
        city: z.string().optional(),
      }),
    }),
  ),
});

/** Photon answers with the names the municipality uses itself (Gent, Antwerpen), which is how Fluvius spells them. */
async function streetAt(at: LatLon): Promise<{ street: string; municipalities: string[] } | null> {
  const url = `https://photon.komoot.io/reverse?lat=${at.lat.toFixed(5)}&lon=${at.lon.toFixed(5)}&limit=1&lang=default`;
  const data = await memo(`dossier-street:${at.lat.toFixed(4)},${at.lon.toFixed(4)}`, DAY_MS, () => fetchJson("Photon geocoder", url, PhotonReverse));
  const p = data.features[0]?.properties;
  if (!p) return null;
  const street = p.street ?? (p.type === "street" ? p.name : undefined);
  const municipalities = [...new Set([p.county, p.city].filter((m): m is string => Boolean(m)))];
  return street && municipalities.length > 0 ? { street, municipalities } : null;
}

const fuelOf = (energie: string): EnergyFuel["fuel"] | null => (/gas/i.test(energie) ? "gas" : /elektr/i.test(energie) ? "electricity" : null);
// "Injectie" rows describe feed-in from solar panels, not use.
const isUse = (richting: string): boolean => richting === "Afname" || richting === "Gecombineerd";
const upper = (s: string): string => s.toLocaleUpperCase("nl-BE");

async function streetRows(street: string, municipality: string): Promise<z.infer<typeof StreetRows>["results"]> {
  return diskMemo(`dossier-fluvius-street-${municipality}-${street}`, DAY_MS, async () => {
    const url = new URL(DATASET);
    // refine matches whole values, so a street name can never alter the query.
    url.searchParams.append("refine", `hoofdgemeente:${upper(municipality)}`);
    url.searchParams.append("refine", `straat:${upper(street)}`);
    url.searchParams.set("select", "verbruiksjaar,energie,richting,aantal_toegangspunten,afname_kwh");
    url.searchParams.set("order_by", "verbruiksjaar desc");
    url.searchParams.set("limit", "30");
    return (await fetchJson(SOURCE, url, StreetRows)).results;
  }, StreetRows.shape.results);
}

async function municipalityAverages(municipality: string, year: string): Promise<Map<EnergyFuel["fuel"], { kwh: number; connections: number }>> {
  const rows = await diskMemo(`dossier-fluvius-town-${municipality}-${year}`, DAY_MS, async () => {
    const url = new URL(DATASET);
    url.searchParams.append("refine", `hoofdgemeente:${upper(municipality)}`);
    url.searchParams.append("refine", `verbruiksjaar:${year}`);
    url.searchParams.set("where", 'richting IN ("Afname","Gecombineerd")');
    url.searchParams.set("select", "energie,sum(afname_kwh) as kwh,sum(aantal_toegangspunten) as n");
    url.searchParams.set("group_by", "energie");
    return (await fetchJson(SOURCE, url, MunicipalityRows)).results;
  }, MunicipalityRows.shape.results);
  const out = new Map<EnergyFuel["fuel"], { kwh: number; connections: number }>();
  for (const r of rows) {
    const fuel = fuelOf(r.energie);
    if (fuel && r.kwh !== null && r.n) out.set(fuel, { kwh: r.kwh, connections: r.n });
  }
  return out;
}

/** The energy use of the street at this point, or null outside Flanders and for streets too small to show. */
export async function energyAt(at: LatLon): Promise<StreetEnergy | null> {
  if (!inFlanders(at)) return null;
  const found = await streetAt(at);
  if (!found) return null;

  for (const municipality of found.municipalities) {
    const rows = await streetRows(found.street, municipality);
    const year = rows[0]?.verbruiksjaar;
    if (!year) continue;

    const totals = new Map<EnergyFuel["fuel"], { kwh: number; connections: number }>();
    for (const r of rows) {
      const fuel = fuelOf(r.energie);
      if (!fuel || r.verbruiksjaar !== year || !isUse(r.richting)) continue;
      const t = totals.get(fuel) ?? { kwh: 0, connections: 0 };
      totals.set(fuel, { kwh: t.kwh + r.afname_kwh, connections: t.connections + r.aantal_toegangspunten });
    }

    const town = await municipalityAverages(municipality, year);
    const fuels = (["gas", "electricity"] as const).flatMap((fuel): EnergyFuel[] => {
      const street = totals.get(fuel);
      const all = town.get(fuel);
      if (!street || !all || street.connections < MIN_CONNECTIONS) return [];
      return [{ fuel, connections: street.connections, streetKwh: street.kwh / street.connections, municipalityKwh: all.kwh / all.connections }];
    });
    if (fuels.length === 0) return null;
    return { street: found.street, municipality, year: Number.parseInt(year, 10), fuels };
  }
  return null;
}
