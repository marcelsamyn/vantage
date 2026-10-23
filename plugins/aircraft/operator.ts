import { modelName } from "./models";
import type { Aircraft, AircraftDetails } from "./types";

/**
 * What an aircraft is for, read from the operator and type that adsbdb knows. Anything else stays "an aircraft":
 * a guess would put a label on a flight that deserves none.
 *
 * Public bodies are named as the registry names them ("Polizia di Stato helicopter"). Other roles stay generic
 * ("survey aircraft"); whoever names the aircraft shows the owner next to the role.
 */

const POLICE = /\b(polizia|police|polic[ií]a|polizei|gendarmerie|carabinieri|guardia civil|guardia di finanza|politie|policja|politi)\b/i;
const FIRE = /\b(fire|firefight|vigili del fuoco|pompieri|bombeiros|feuerwehr|protezione civile|civil protection|sapeurs)\b/i;
const COAST = /\b(coast ?guard|guardia costiera|rescue|soccorso)\b/i;
const MEDICAL = /\b(ambulance|ambulanza|hems|rettung|samu|christoph|air methods|medevac|life ?flight|medical)\b/i;
const SURVEY = /\b(survey|aerial|aerofoto|aerofotogrammetria|photogramm|geomatic|geospatial|mapping|lidar|cartograph|topograph|geodetic|remote sensing)\b/i;
const NEWS = /\b(news|television|tv|broadcast)\b/i;
const TRAINING = /\b(flight school|flying school|aero ?club|flying club|flugschule|fliegerschule|scuola di volo|aviation academy|training)\b/i;

export function isHelicopter(a: Pick<Aircraft, "category" | "typeCode">): boolean {
  return a.category === "A7" || (modelName(a.typeCode)?.includes("(helicopter)") ?? false);
}

/** "Polizia di Stato helicopter", "survey aircraft", or "an aircraft". */
export function describeAircraft(a: Pick<Aircraft, "category" | "typeCode" | "military">, details: Pick<AircraftDetails, "owner"> | undefined): string {
  const craft = isHelicopter(a) ? "helicopter" : "aircraft";
  const owner = details?.owner?.trim() ?? "";
  if (owner) {
    if (POLICE.test(owner) || FIRE.test(owner) || COAST.test(owner)) return `${owner} ${craft}`;
    if (MEDICAL.test(owner)) return craft === "helicopter" ? "air ambulance helicopter" : "air ambulance";
    if (SURVEY.test(owner)) return "survey aircraft";
    if (NEWS.test(owner)) return `news ${craft}`;
    if (TRAINING.test(owner)) return "training aircraft";
  }
  if (a.military) return `military ${craft}`;
  return craft === "helicopter" ? "a helicopter" : "an aircraft";
}
