import { log } from "../../server/kit";
import { distanceM, type LatLon } from "../../shared/geo";
import { inBrussels, inRome } from "./area.server";
import { energyAt } from "./fluvius.server";
import { grandPlaceBuildings, heritageNear } from "./heritage.server";
import { nasoni } from "./nasoni.server";
import { parkingAt } from "./parking.server";
import { thickestNear } from "./trees.server";
import type { DidYouKnow } from "./types";
import { wifiDay } from "./wifi.server";

/**
 * "Did you know": surprising public facts about the spot, one per source that has something to say.
 * A distance is written "{m:120}" so the browser can print it in the user's units.
 */

const HERITAGE_RADIUS_M = 150;
const TREE_RADIUS_M = 500;
const WIFI_RADIUS_M = 1000;

const LANGUAGES = new Intl.DisplayNames("en", { type: "language" });
const languageName = (code: string): string => {
  try {
    return LANGUAGES.of(code) ?? code;
  } catch {
    return code;
  }
};

const kwh = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const away = (metres: number): string => (metres === 0 ? "right where you are" : `{m:${metres}} from you`);

async function heritageFact(at: LatLon): Promise<DidYouKnow | null> {
  if (inBrussels(at)) {
    const grand = (await grandPlaceBuildings())
      .map((b) => ({ b, d: distanceM(at, b) }))
      .filter(({ b, d }) => d <= HERITAGE_RADIUS_M && b.didYouKnow)
      .sort((a, b) => a.d - b.d)[0];
    if (grand?.b.didYouKnow) {
      return { id: `grand-place-${grand.b.id}`, topic: "Grand-Place", text: `${grand.b.name}, ${grand.b.address ?? "Grand-Place"}: ${grand.b.didYouKnow}`, source: "City of Brussels open data" };
    }
  }

  const heritage = await heritageNear(at, HERITAGE_RADIUS_M, 1);
  const entry = heritage?.entries[0];
  if (!heritage || !entry) return null;
  const detail = [entry.kind, entry.period].filter(Boolean).join(", ");
  return {
    id: `heritage-${entry.id}`,
    topic: "Heritage",
    text: `Nearest heritage record: ${entry.title}${detail ? ` (${detail})` : ""}, ${away(entry.distanceM)}.`,
    source: heritage.source,
  };
}

async function treeFact(at: LatLon): Promise<DidYouKnow | null> {
  const found = await thickestNear(at, TREE_RADIUS_M);
  const girthCm = found?.tree.girthCm;
  if (!found || !girthCm) return null;
  const { tree } = found;
  const name = tree.commonName && tree.commonName !== tree.species ? `${tree.commonName} (${tree.species})` : tree.species;
  const planted = tree.plantedYear ? `, planted in ${tree.plantedYear}` : "";
  return {
    id: `tree-${tree.id}`,
    topic: "Trees",
    text: `Thickest registered tree within {m:${TREE_RADIUS_M}}: ${name}, ${away(tree.distanceM)}, ${kwh.format(girthCm)} cm round${planted}.`,
    source: found.source,
  };
}

async function energyFact(at: LatLon): Promise<DidYouKnow | null> {
  const energy = await energyAt(at);
  const fuel = energy?.fuels[0];
  if (!energy || !fuel) return null;
  const diff = Math.round(Math.abs(fuel.streetKwh / fuel.municipalityKwh - 1) * 100);
  const compare = diff < 3 ? "about the same as" : `${diff} % ${fuel.streetKwh < fuel.municipalityKwh ? "below" : "above"}`;
  const what = fuel.fuel === "gas" ? "gas" : "electricity";
  return {
    id: `energy-${energy.street}`,
    topic: "Your street",
    text: `In ${energy.year}, the average ${what} connection on ${energy.street} used ${kwh.format(fuel.streetKwh)} kWh, ${compare} the ${energy.municipality} average of ${kwh.format(fuel.municipalityKwh)} kWh.`,
    source: "Fluvius open data",
  };
}

async function nasoneFact(at: LatLon): Promise<DidYouKnow | null> {
  if (!inRome(at)) return null;
  const { fountains } = await nasoni();
  const nearest = fountains.map((f) => ({ f, d: distanceM(at, f) })).sort((a, b) => a.d - b.d)[0];
  if (!nearest) return null;
  return {
    id: "nasone",
    topic: "Nasoni",
    text: `The nearest nasone, one of ${kwh.format(fountains.length)} cast-iron drinking fountains mapped across Rome, is {m:${Math.round(nearest.d)}} away.`,
    source: "OpenStreetMap contributors",
  };
}

async function parkingFact(at: LatLon): Promise<DidYouKnow | null> {
  const parking = await parkingAt(at);
  const s = parking?.segment;
  if (!parking || !s) return null;
  return {
    id: `parking-${s.street}`,
    topic: "Parking",
    text: `${s.street} is on Rome's blue lines: ${s.tariff}, ${s.days}, ${s.from} to ${s.to}.`,
    source: "Roma Capitale open data",
  };
}

async function wifiFact(at: LatLon): Promise<DidYouKnow | null> {
  if (!inRome(at)) return null;
  const day = await wifiDay();
  const busiest = day.hotspots.map((h) => ({ h, d: distanceM(at, h) })).filter(({ d }) => d <= WIFI_RADIUS_M).sort((a, b) => b.h.sessions - a.h.sessions)[0];
  if (!busiest) return null;
  const top = busiest.h.languages[0];
  const language = top ? ` ${Math.round(top.share * 100)} % of them used the ${languageName(top.code)} interface.` : "";
  return {
    id: `wifi-${busiest.h.id}`,
    topic: "City Wi-Fi",
    text: `On ${day.date}, the busiest public Wi-Fi hotspot within {m:${WIFI_RADIUS_M}}, ${busiest.h.address}, logged ${kwh.format(busiest.h.sessions)} sessions.${language}`,
    source: "Roma Capitale open data",
  };
}

/** Every fact the registers can offer for this spot. A source that fails is logged and skipped, so one outage does not empty the tile. */
export async function factsAt(at: LatLon): Promise<DidYouKnow[]> {
  const attempts = await Promise.allSettled([heritageFact(at), treeFact(at), energyFact(at), nasoneFact(at), parkingFact(at), wifiFact(at)]);
  const facts: DidYouKnow[] = [];
  for (const attempt of attempts) {
    if (attempt.status === "fulfilled") {
      if (attempt.value) facts.push(attempt.value);
    } else {
      log.warn("dossier fact source failed", { error: attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason) });
    }
  }
  if (facts.length === 0 && attempts.every((a) => a.status === "rejected")) {
    const first = attempts[0];
    throw first?.status === "rejected" ? first.reason : new Error("No source answered");
  }
  return facts;
}
