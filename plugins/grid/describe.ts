import { fmt } from "../../app/core/format";
import type { ThingRow } from "../../app/core/things";
import type { Tone } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import type { GridKind, GridRef } from "./types";

/**
 * What each kind of street-grid object is called, and what is worth reading from its OpenStreetMap tags.
 * Shared by the Profiler and by the thing source, so a defibrillator reads the same wherever it shows up.
 */

type Tags = Record<string, string>;

/** A row as the table below writes it: `tag && ["Label", …]`. A row whose tag or value is missing is dropped. */
type DescribedRow = readonly [label: string, value: string | null | undefined] | null | false | undefined | "";

export interface Describe {
  band: string;
  fallbackName: string;
  tone: Tone;
  rows: (t: Tags, ref: GridRef) => DescribedRow[];
  fact: (t: Tags, ref: GridRef) => string;
}

export const yesNo = (v: string | undefined): string | null => (v === "yes" ? "Yes" : v === "no" ? "No" : (v ?? null));
const words = (v: string | undefined): string | null => (v ? v.replace(/[_;]/g, " ").replace(/\s+/g, " ") : null);
const voltage = (v: string | undefined): string | null =>
  v
    ? v
        .split(";")
        .map((x) => `${fmt.int(Number(x) / 1000)} kV`)
        .join(" · ")
    : null;
export const address = (t: Tags): string | null => [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ") || null;

const ALPR = (t: Tags): boolean => t["surveillance:type"] === "ALPR" || /\b(ZTL|ANPR|ALPR)\b/i.test(t.name ?? "");

export const DESCRIBE: Record<GridKind, Describe> = {
  camera: {
    band: "Surveillance camera",
    fallbackName: "Camera",
    tone: "alarm",
    rows: (t, r) => [
      r.directions.length > 0 && ["Watching", r.directions.map((d) => `${compassPoint(d)} (${Math.round(d)}°)`).join(", ")],
      ["Type", ALPR(t) ? "Number-plate reader" : (words(t["camera:type"]) ?? "Camera")],
      t["camera:mount"] && ["Mounted on", words(t["camera:mount"])],
      t["surveillance:zone"] && ["Watches", words(t["surveillance:zone"])],
      t.surveillance && ["Area", words(t.surveillance)],
      t.operator && ["Operator", t.operator],
    ],
    fact: (t) =>
      ALPR(t)
        ? "This camera reads number plates, so it logs every vehicle that passes, not only offenders."
        : "Mapped by OpenStreetMap volunteers. Data-protection laws in many countries require a sign that names who is recording.",
  },
  signal: {
    band: "Traffic signal",
    fallbackName: "Traffic signal",
    tone: "ice",
    rows: (t) => [
      t.crossing && ["Crossing", words(t.crossing)],
      t["traffic_signals:sound"] && ["Sound for blind pedestrians", yesNo(t["traffic_signals:sound"])],
      t["traffic_signals:vibration"] && ["Vibration", yesNo(t["traffic_signals:vibration"])],
      t.button_operated && ["Push button", yesNo(t.button_operated)],
    ],
    fact: (t) =>
      t["traffic_signals:sound"] === "yes"
        ? "It plays a sound when pedestrians may cross, so blind people know when it is safe."
        : "VANTAGE knows where the city's signals are, not what colour they show. That data belongs to the road authority.",
  },
  wifi: {
    band: "Public Wi-Fi",
    fallbackName: "Wi-Fi hotspot",
    tone: "ice",
    rows: (t) => [
      t.amenity && ["Place", words(t.amenity)],
      t["internet_access:ssid"] && ["Network name", t["internet_access:ssid"]],
      ["Fee", yesNo(t["internet_access:fee"]) ?? "Not recorded"],
      t["internet_access:operator"] && ["Operator", t["internet_access:operator"]],
      t.opening_hours && ["Hours", t.opening_hours],
      address(t) && ["Address", address(t)],
    ],
    fact: () => "Strangers share public networks. Use sites with HTTPS, and avoid typing passwords unless you use a VPN.",
  },
  tower: {
    band: "Comms tower",
    fallbackName: "Communications tower",
    tone: "sodium",
    rows: (t) => [
      t.height && ["Height", `${t.height} m`],
      t.operator && ["Operator", t.operator],
      t["communication:mobile_phone"] && ["Mobile antennas", yesNo(t["communication:mobile_phone"])],
      t["communication:television"] && ["Television", yesNo(t["communication:television"])],
      t["communication:radio"] && ["Radio", yesNo(t["communication:radio"])],
    ],
    fact: () => "Your phone talks to the nearest towers like this one, so your mobile operator always knows roughly where you are.",
  },
  substation: {
    band: "Power grid",
    fallbackName: "Substation",
    tone: "sodium",
    rows: (t) => [voltage(t.voltage) && ["Voltage", voltage(t.voltage)], t.substation && ["Role", words(t.substation)], t.operator && ["Operator", t.operator]],
    fact: () => "Substations step high transmission voltages down to the 230 or 120 volts that reach your sockets.",
  },
  powerline: {
    band: "Power grid",
    fallbackName: "Power line",
    tone: "sodium",
    rows: (t) => [voltage(t.voltage) && ["Voltage", voltage(t.voltage)], t.cables && ["Cables", t.cables], t.frequency && ["Frequency", `${t.frequency} Hz`], t.operator && ["Operator", t.operator]],
    fact: () => "Long-distance lines run at very high voltage because that loses less energy as heat.",
  },
  police: {
    band: "Emergency services",
    fallbackName: "Police station",
    tone: "ice",
    rows: (t) => [address(t) && ["Address", address(t)], t.phone && ["Phone", t.phone], t.opening_hours && ["Hours", t.opening_hours], t.operator && ["Operator", t.operator]],
    fact: () => "For an emergency, call your local emergency number rather than going to the station.",
  },
  fire: {
    band: "Emergency services",
    fallbackName: "Fire station",
    tone: "alarm",
    rows: (t) => [address(t) && ["Address", address(t)], t.operator && ["Operator", t.operator]],
    fact: () => "Fire stations are placed so crews can reach most addresses in their area within minutes.",
  },
  hospital: {
    band: "Emergency services",
    fallbackName: "Hospital",
    tone: "mint",
    rows: (t) => [t.emergency && ["Emergency department", yesNo(t.emergency)], address(t) && ["Address", address(t)], t.phone && ["Phone", t.phone], t.operator && ["Operator", t.operator]],
    fact: (t) => (t.emergency === "yes" ? "This hospital has an emergency department." : "Check before you go: OpenStreetMap does not record an emergency department here."),
  },
  aed: {
    band: "Defibrillator",
    fallbackName: "Defibrillator (AED)",
    tone: "mint",
    rows: (t) => [
      t["defibrillator:location"] && ["Where exactly", t["defibrillator:location"]],
      t.indoor && ["Indoors", yesNo(t.indoor)],
      t.access && ["Access", words(t.access)],
      t.opening_hours && ["Hours", t.opening_hours],
      t.operator && ["Operator", t.operator],
      t.phone && ["Phone", t.phone],
    ],
    fact: () => "Call your local emergency number first. An AED speaks its instructions aloud and only shocks when the heart rhythm needs it.",
  },
  water: {
    band: "Drinking water",
    fallbackName: "Drinking fountain",
    tone: "ice",
    rows: (t) => [t.bottle && ["Bottle refill", yesNo(t.bottle)], t.seasonal && ["Seasonal", yesNo(t.seasonal)], t.fee && ["Fee", yesNo(t.fee)]],
    fact: () => "Free, drinkable water, mapped by volunteers. Refill instead of buying a bottle.",
  },
  toilets: {
    band: "Public toilet",
    fallbackName: "Toilets",
    tone: "ice",
    rows: (t) => [
      ["Fee", yesNo(t.fee) ?? "Not recorded"],
      t.wheelchair && ["Wheelchair access", yesNo(t.wheelchair)],
      t.changing_table && ["Baby changing", yesNo(t.changing_table)],
      t.opening_hours && ["Hours", t.opening_hours],
    ],
    fact: () => "Mapped by OpenStreetMap volunteers; opening hours can change, so check on site.",
  },
  ev: {
    band: "EV charging",
    fallbackName: "Charging station",
    tone: "mint",
    rows: (t) => [
      t.capacity && ["Charging points", t.capacity],
      ["Sockets", Object.keys(t).filter((k) => /^socket:[^:]+$/.test(k)).map((k) => `${k.slice(7).replace(/_/g, " ")} ×${t[k]}`).join(", ") || "Not recorded"],
      t.operator && ["Operator", t.operator],
      t.fee && ["Fee", yesNo(t.fee)],
      t.opening_hours && ["Hours", t.opening_hours],
    ],
    fact: () => "Socket types and prices change often; the operator's app has the live status of each charger.",
  },
  station: {
    band: "Station",
    fallbackName: "Station",
    tone: "ice",
    rows: (t) => [t.network && ["Network", t.network], t.operator && ["Operator", t.operator], t.wheelchair && ["Wheelchair access", yesNo(t.wheelchair)]],
    fact: () => "A rail or metro station, from OpenStreetMap.",
  },
  bridge: {
    band: "Movable bridge",
    fallbackName: "Movable bridge",
    tone: "sodium",
    rows: (t) => [t["bridge:movable"] && ["Moves by", words(t["bridge:movable"])], t.operator && ["Operator", t.operator]],
    fact: () => "In Watch Dogs, Aiden raises bridges to escape. Real ones open for ships, on a schedule set by their operator.",
  },
};

/** The rows worth showing for one object, with the ones its tags say nothing about left out. */
export function describeRows(kind: GridKind, ref: GridRef): ThingRow[] {
  const out: ThingRow[] = [];
  for (const row of DESCRIBE[kind].rows(ref.tags, ref)) {
    if (!row) continue;
    const [label, value] = row;
    if (value !== null && value !== undefined) out.push([label, value]);
  }
  return out;
}
