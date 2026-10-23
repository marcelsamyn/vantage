import { browseServiceTypes, browseServices, describe, log, resolveHostIpv4, unescapeName, type MdnsService } from "../../server/kit";

/**
 * Bonjour (mDNS) discovery of the devices on the local network, through the kit's `dns-sd` helpers. It only
 * listens for what devices announce; it never connects to any service. Three windows run in a row:
 *   1. browse the list of service types on the network,
 *   2. for the useful types, browse and resolve instances,
 *   3. map each announced host name to its IPv4 address.
 */

const TYPES_WINDOW_MS = 3_000;
const INSTANCES_WINDOW_MS = 3_000;
const HOSTS_WINDOW_MS = 2_000;
const MAX_TYPES = 15;
const MAX_HOSTS = 60;

/** Service types that say something about what a device is, most useful first. */
const RELEVANT_TYPES = [
  "_airplay._tcp",
  "_raop._tcp",
  "_googlecast._tcp",
  "_spotify-connect._tcp",
  "_companion-link._tcp",
  "_mediaremotetv._tcp",
  "_androidtvremote2._tcp",
  "_amzn-wplay._tcp",
  "_sonos._tcp",
  "_hap._tcp",
  "_homekit._tcp",
  "_hue._tcp",
  "_matter._tcp",
  "_matterc._udp",
  "_matterd._udp",
  "_ipp._tcp",
  "_ipps._tcp",
  "_printer._tcp",
  "_pdl-datastream._tcp",
  "_scanner._tcp",
  "_nvstream_dbd._tcp",
  "_smb._tcp",
  "_afpovertcp._tcp",
  "_ssh._tcp",
  "_rfb._tcp",
  "_workstation._tcp",
  "_device-info._tcp",
  "_daap._tcp",
  "_http._tcp",
];

/** Types that exist on every Mac and say nothing about other devices. */
const NOISE = /^_(?:asquic|sleep-proxy|rdlink|remotepairing|remotepairing-manual-pairing|apple-mobdev2|trel|meshcop)\./;

/** Friendly labels for the services people recognise. Unknown types are shown by their bare name. */
const LABELS: Record<string, string> = {
  _airplay: "AirPlay",
  _raop: "AirPlay audio",
  _googlecast: "Google Cast",
  "_spotify-connect": "Spotify Connect",
  "_companion-link": "Apple device link",
  _mediaremotetv: "Apple TV remote",
  _androidtvremote2: "Android TV remote",
  "_amzn-wplay": "Alexa playback",
  _sonos: "Sonos",
  _hap: "HomeKit",
  _homekit: "HomeKit",
  _hue: "Philips Hue",
  _matter: "Matter",
  _matterc: "Matter",
  _matterd: "Matter",
  _ipp: "Printing",
  _ipps: "Printing",
  _printer: "Printing",
  "_pdl-datastream": "Printing",
  _scanner: "Scanning",
  _nvstream_dbd: "GameStream",
  _smb: "File sharing",
  _afpovertcp: "File sharing",
  _ssh: "Remote login",
  _rfb: "Screen sharing",
  _workstation: "Workstation",
  _daap: "Media sharing",
  _http: "Web page",
};

export interface BonjourRecord {
  /** Raw service types the device announces, e.g. "_airplay._tcp". */
  types: string[];
  /** Friendly device name, e.g. "Living Room", or null when nothing readable is announced. */
  name: string | null;
  /** Announced hardware model such as "AppleTV6,2" or "Chromecast". */
  model: string | null;
}

export interface BonjourScan {
  /** False when `dns-sd` could not run. */
  available: boolean;
  byIp: Map<string, BonjourRecord>;
}

export function serviceLabel(type: string): string | null {
  const bare = type.split(".")[0] ?? type;
  if (bare === "_device-info") return null;
  return LABELS[bare] ?? bare.replace(/^_/, "");
}

// ── Type choice ───────────────────────────────────────────────────

export function chooseTypes(found: string[]): string[] {
  const usable = found.filter((t) => !NOISE.test(t));
  const ranked = RELEVANT_TYPES.filter((t) => usable.includes(t));
  const rest = usable.filter((t) => !RELEVANT_TYPES.includes(t));
  return [...ranked, ...rest].slice(0, MAX_TYPES);
}

// ── Names and models ──────────────────────────────────────────────

const looksLikeId = (s: string): boolean => /^[0-9a-f]{10,}$/i.test(s) || /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(s);

/** Which announced instance name is a person-readable device name, by service type. Higher wins. */
const NAME_RANK: Record<string, number> = { _airplay: 9, _googlecast: 8, "_companion-link": 7, _raop: 6, _hap: 5, _homekit: 5, _hue: 5, _ipp: 4, _ipps: 4, _printer: 4, _smb: 3, _workstation: 2, _http: 1 };

function readableName(inst: MdnsService): string | null {
  const bare = inst.type.split(".")[0] ?? "";
  let name = inst.name;
  if (bare === "_raop") name = name.includes("@") ? name.slice(name.indexOf("@") + 1) : name;
  if (bare === "_googlecast") name = inst.txt["fn"] ?? "";
  if (bare === "_workstation") name = name.replace(/\s*\[[0-9a-f:]+\]\s*$/i, "");
  name = name.trim();
  if (!name || looksLikeId(name) || (NAME_RANK[bare] ?? 0) === 0) return null;
  return name;
}

function announcedModel(inst: MdnsService): string | null {
  const t = inst.txt;
  return t["model"] ?? t["rpmd"] ?? t["md"] ?? t["ty"] ?? t["am"] ?? null;
}

// ── Short memory ──────────────────────────────────────────────────

/**
 * mDNS answers arrive when devices feel like sending them, so one 3 s window can miss a service that the
 * previous scan caught. Records are kept for ten minutes and merged, which keeps a device's guessed kind steady.
 */
const REMEMBER_MS = 10 * 60_000;
const remembered = new Map<string, BonjourRecord & { at: number }>();

function remember(fresh: Map<string, BonjourRecord>): Map<string, BonjourRecord> {
  const now = Date.now();
  for (const [ip, rec] of fresh) {
    const old = remembered.get(ip);
    remembered.set(ip, { types: [...new Set([...(old?.types ?? []), ...rec.types])], name: rec.name ?? old?.name ?? null, model: rec.model ?? old?.model ?? null, at: now });
  }
  const merged = new Map<string, BonjourRecord>();
  for (const [ip, rec] of remembered) {
    if (now - rec.at > REMEMBER_MS) remembered.delete(ip);
    else merged.set(ip, { types: rec.types, name: rec.name, model: rec.model });
  }
  return merged;
}

// ── Scan ──────────────────────────────────────────────────────────

export async function scanBonjour(): Promise<BonjourScan> {
  try {
    const types = chooseTypes(await browseServiceTypes(TYPES_WINDOW_MS));
    const instances = (await Promise.all(types.map((type) => browseServices(type, INSTANCES_WINDOW_MS)))).flat();

    const hosts = [...new Set(instances.map((i) => i.host))].slice(0, MAX_HOSTS);
    const resolved = await Promise.all(hosts.map(async (host) => [host, await resolveHostIpv4(host, HOSTS_WINDOW_MS)] as const));
    const ipsOf = new Map(resolved);

    const byIp = new Map<string, BonjourRecord & { rank: number }>();
    for (const inst of instances) {
      const name = readableName(inst);
      const rank = name ? (NAME_RANK[inst.type.split(".")[0] ?? ""] ?? 0) : 0;
      for (const ip of ipsOf.get(inst.host) ?? []) {
        const rec = byIp.get(ip) ?? { types: [], name: null, model: null, rank: 0 };
        if (!rec.types.includes(inst.type)) rec.types.push(inst.type);
        if (name && rank > rec.rank) {
          rec.name = name;
          rec.rank = rank;
        }
        rec.model ??= announcedModel(inst);
        byIp.set(ip, rec);
      }
    }
    // A device that announces no readable service name still has a host name such as "Tempest.local".
    for (const inst of instances) {
      for (const ip of ipsOf.get(inst.host) ?? []) {
        const rec = byIp.get(ip);
        const label = inst.host.replace(/\.local$/i, "");
        if (rec && !rec.name && label && !looksLikeId(label)) rec.name = unescapeName(label);
      }
    }
    return { available: true, byIp: remember(new Map([...byIp].map(([ip, { types, name, model }]) => [ip, { types, name, model }]))) };
  } catch (err) {
    log.warn("bonjour scan failed", { error: describe(err) });
    return { available: false, byIp: new Map() };
  }
}
