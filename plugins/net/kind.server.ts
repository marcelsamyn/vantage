import type { DeviceKind } from "./types";

/**
 * Guess what a device is from what it announces. Evidence is ranked: Bonjour services and models first (the device
 * says it itself), then its name, then the maker of its network chip. Every guess carries a plain sentence that says
 * which evidence was used, so the screen never presents a guess as a fact.
 */

export interface KindEvidence {
  isGateway: boolean;
  isThisMac: boolean;
  /** Raw Bonjour service types, e.g. "_airplay._tcp". */
  types: string[];
  /** Friendly service names, used to word the sentence. */
  serviceLabels: string[];
  model: string | null;
  name: string | null;
  vendor: string | null;
  randomized: boolean;
}

export interface KindGuess {
  kind: DeviceKind;
  note: string | null;
}

const NOUN: Record<DeviceKind, string> = {
  router: "a router",
  computer: "a computer",
  phone: "a phone",
  tablet: "a tablet",
  tv: "a TV or media player",
  speaker: "a speaker",
  printer: "a printer",
  camera: "a camera",
  console: "a game console",
  iot: "a smart-home device",
  unknown: "an unidentified device",
};

const has = (types: string[], ...bare: string[]): boolean => types.some((t) => bare.includes(t.split(".")[0] ?? ""));

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function fromModel(model: string): DeviceKind | null {
  if (/^iPhone/i.test(model)) return "phone";
  if (/^iPad/i.test(model)) return "tablet";
  if (/^AppleTV/i.test(model)) return "tv";
  if (/^AudioAccessory/i.test(model)) return "speaker";
  if (/^(Mac|MacBook|iMac|Macmini|MacPro)/i.test(model)) return "computer";
  if (/chromecast|google tv|android tv|bravia|\btv\b/i.test(model)) return "tv";
  if (/google home|nest (mini|audio|hub)|home mini|speaker|soundbar/i.test(model)) return "speaker";
  return null;
}

function fromServices(types: string[]): DeviceKind | null {
  if (has(types, "_ipp", "_ipps", "_printer", "_pdl-datastream", "_scanner")) return "printer";
  if (has(types, "_androidtvremote2", "_mediaremotetv")) return "tv";
  if (has(types, "_googlecast")) return "tv";
  if (has(types, "_spotify-connect", "_sonos", "_amzn-wplay")) return "speaker";
  if (has(types, "_raop") && !has(types, "_airplay")) return "speaker";
  if (has(types, "_hue", "_hap", "_homekit", "_matter", "_matterc", "_matterd")) return "iot";
  if (has(types, "_nvstream_dbd", "_smb", "_afpovertcp", "_ssh", "_rfb", "_workstation")) return "computer";
  return null;
}

const NAME_RULES: [RegExp, DeviceKind][] = [
  [/iphone|android|pixel|galaxy|oneplus|redmi|xiaomi|huawei|oppo/i, "phone"],
  [/ipad|tablet|\btab\b/i, "tablet"],
  [/macbook|imac|mac-?mini|mac-?studio|mac-?pro|laptop|desktop|thinkpad|surface|\bpc\b|workstation/i, "computer"],
  [/apple-?tv|roku|fire-?tv|chromecast|bravia|\btv\b|shield/i, "tv"],
  [/homepod|echo|alexa|sonos|speaker|soundbar|nest-?(mini|audio)|google-?home/i, "speaker"],
  [/printer|laserjet|officejet|deskjet|epson|brother|pixma/i, "printer"],
  [/camera|\bcam\b|doorbell|ring-|arlo|wyze/i, "camera"],
  [/playstation|\bps[45]\b|xbox|nintendo|steam-?deck/i, "console"],
];

/** Makers whose products are mostly one kind of device. `makes` completes "which makes …". */
const VENDOR_RULES: [RegExp, DeviceKind, string][] = [
  [/espressif|tuya|shelly|sonoff|itead|signify|philips lighting|lifx|nanoleaf|yeelight|meross|govee|aqara|ecobee|netatmo|belkin/i, "iot", "smart-home gear"],
  [/brother|epson|canon|lexmark|xerox|kyocera|ricoh|konica/i, "printer", "printers"],
  [/nintendo|sony interactive|valve/i, "console", "game consoles"],
  [/sonos|\bbose\b|harman|denon|marantz/i, "speaker", "speakers"],
  [/roku|vizio|hisense|\btcl\b/i, "tv", "TVs and streaming players"],
  [/\bring\b|\barlo\b|\bwyze\b|hikvision|dahua|reolink|eufy|axis communications/i, "camera", "cameras"],
  [/qnap|synology|raspberry|\bdell\b|lenovo|intel corporate|micro-star|gigabyte/i, "computer", "computers and storage"],
  [/netgear|ubiquiti|mikrotik|linksys|eero|zyxel|sagemcom|technicolor|vantiva|arris|tp-link|d-link/i, "router", "network equipment"],
];

export function guessKind(e: KindEvidence): KindGuess {
  if (e.isThisMac) return { kind: "computer", note: "This Mac. VANTAGE runs on it." };
  if (e.isGateway) return { kind: "router", note: "The default gateway: your traffic to the internet passes through it." };

  const byModel = e.model ? fromModel(e.model) : null;
  if (byModel && e.model) return { kind: byModel, note: `Reports the hardware model ${e.model}, so it is probably ${NOUN[byModel]}.` };

  const byServices = fromServices(e.types);
  if (byServices) {
    const labels = [...new Set(e.serviceLabels)].slice(0, 3);
    return { kind: byServices, note: `Announces ${joinList(labels)}, so it is probably ${NOUN[byServices]}.` };
  }

  const byName = e.name ? NAME_RULES.find(([re]) => re.test(e.name ?? "")) : undefined;
  if (byName && e.name) return { kind: byName[1], note: `Its name, "${e.name}", suggests ${NOUN[byName[1]]}.` };

  const byVendor = e.vendor ? VENDOR_RULES.find(([re]) => re.test(e.vendor ?? "")) : undefined;
  if (byVendor && e.vendor) return { kind: byVendor[1], note: `Made by ${e.vendor}, which makes ${byVendor[2]}, so it is probably ${NOUN[byVendor[1]]}.` };

  if (e.randomized) return { kind: "unknown", note: "Uses a private Wi-Fi address, so the maker of the device is hidden. Phones, tablets and laptops do this to avoid tracking." };
  if (e.vendor) return { kind: "unknown", note: `Made by ${e.vendor}. It announces nothing else about itself.` };
  return { kind: "unknown", note: null };
}
