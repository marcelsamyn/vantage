/** Payloads served by /api/dossier. Shared by api.ts (server) and client.ts. */

// ── Heritage ────────────────────────────────────────────────────

export interface HeritageEntry {
  id: string;
  title: string;
  /** What kind of object the register says it is: "casa", "hotels", "Guild house". */
  kind: string | null;
  /** The period as the register words it, e.g. "sec. XV-XVIII" or "18de eeuw". */
  period: string | null;
  /** The builders, workshop or designer credited by the register. */
  author: string | null;
  /** One sentence from the register describing the object. */
  note: string | null;
  distanceM: number;
  /** The official record, opened in the register's own site. */
  url: string;
}

export interface Heritage {
  /** Name of the register that answered, e.g. "Catalogo generale dei beni culturali". */
  source: string;
  entries: HeritageEntry[];
}

// ── Street energy use (Flanders) ────────────────────────────────

export interface EnergyFuel {
  fuel: "gas" | "electricity";
  connections: number;
  /** Average yearly use per connection on this street, in kWh. */
  streetKwh: number;
  /** The same average over the whole municipality. */
  municipalityKwh: number;
}

export interface StreetEnergy {
  street: string;
  municipality: string;
  year: number;
  fuels: EnergyFuel[];
}

// ── Trees ───────────────────────────────────────────────────────

export interface TreeRecord {
  id: string;
  /** Latin name when the register gives one, otherwise the common name. */
  species: string;
  commonName: string | null;
  plantedYear: number | null;
  heightM: number | null;
  /** Height as the register's size class, e.g. "> 23 m", when it has no measurement. */
  heightClass: string | null;
  girthCm: number | null;
  girthClass: string | null;
  crownM: number | null;
  remarkable: boolean;
  address: string | null;
  lat: number;
  lon: number;
  distanceM: number;
  /** Link to the register's page for this tree, when one exists. */
  url: string | null;
}

export interface Trees {
  /** Name of the register, e.g. "City of Brussels · Remarkable trees". */
  source: string;
  trees: TreeRecord[];
}

/** One tree on the map. */
export interface MapTree {
  id: string;
  name: string;
  lat: number;
  lon: number;
  remarkable: boolean;
}

export interface TreeTile {
  /** Registers that cover this tile; empty outside the supported cities. */
  sources: string[];
  trees: MapTree[];
  /** True when the tile held more trees than the layer draws. */
  truncated: boolean;
}

// ── Rome pay-parking ────────────────────────────────────────────

export interface ParkingSegment {
  street: string;
  area: string;
  zone: string;
  days: string;
  from: string;
  to: string;
  tariff: string;
  distanceM: number;
}

export interface ParkingMeter {
  address: string;
  detail: string | null;
  payments: string;
  tariff: string;
  distanceM: number;
}

export interface Parking {
  /** Set when the place is on a blue-line street segment. */
  segment: ParkingSegment | null;
  meters: ParkingMeter[];
  /** Date of the published file, e.g. "2026-07-23". */
  asOf: string;
}

// ── Points of interest on the map ───────────────────────────────

export interface Nasone {
  id: number;
  lat: number;
  lon: number;
  /** OpenStreetMap's last survey date for this fountain, when recorded. */
  checked: string | null;
}

export interface Nasoni {
  fountains: Nasone[];
}

export interface WifiLanguage {
  /** ISO language code as the city logs it, e.g. "it". */
  code: string;
  /** Share of the hotspot's sessions with a known language, 0 to 1. */
  share: number;
}

export interface WifiHotspot {
  id: string;
  address: string;
  /** The city office or site the hotspot serves, when the city names one. */
  venue: string | null;
  municipio: string;
  lat: number;
  lon: number;
  sessions: number;
  bytes: number;
  languages: WifiLanguage[];
}

export interface WifiDay {
  /** Day the sessions were logged, "2026-10-07". */
  date: string;
  /** Hotspots left out because the city gave no position for them. */
  hiddenHotspots: number;
  totalSessions: number;
  hotspots: WifiHotspot[];
}

// ── "Did you know" ──────────────────────────────────────────────

export interface DidYouKnow {
  id: string;
  /** Short label for the fact's topic. */
  topic: string;
  /** Plain text. A distance is written "{m:120}" so the browser can show it in the user's units. */
  text: string;
  source: string;
}

export interface Facts {
  facts: DidYouKnow[];
}

// ── Public tenders (EU TED) ─────────────────────────────────────

/** One contract notice by a public authority: an organisation, never a person. */
export interface Tender {
  /** TED's publication number, e.g. "620291-2026". */
  id: string;
  /** ISO date. */
  published: string;
  title: string;
  /** What is being bought, as the EU's procurement vocabulary names it: "Cleaning services". */
  category: string | null;
  buyer: string;
  /** Estimated value of the whole notice, rounded; null when the buyer does not state one. */
  value: number | null;
  currency: string | null;
  /** ISO date by which all tenders must be in; null when the notice gives none. */
  deadline: string | null;
  nature: "supplies" | "services" | "works" | null;
  /** The notice on TED. */
  url: string;
}

export interface Tenders {
  /** The city the buyers are in, as the geocoder names it. */
  city: string;
  sinceDays: number;
  /** All contract notices in the window; `tenders` holds the newest of them. */
  total: number;
  tenders: Tender[];
}
