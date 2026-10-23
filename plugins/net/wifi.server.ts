import { HttpError, memo, parseUpstream, run, z } from "../../server/kit";
import type { WifiBand, WifiInfo, WifiNetwork, WifiSummary } from "./types";

/** Wi-Fi state from `system_profiler SPAirPortDataType`. The command takes about 5 s, so results are memoised. */

const Network = z.object({
  _name: z.string().optional(),
  spairport_network_channel: z.string().optional(),
  spairport_network_country_code: z.string().optional(),
  spairport_network_phymode: z.string().optional(),
  spairport_network_rate: z.number().optional(),
  spairport_security_mode: z.string().optional(),
  spairport_signal_noise: z.string().optional(),
});

const WifiInterface = z.object({
  _name: z.string(),
  spairport_status_information: z.string().optional(),
  spairport_current_network_information: Network.optional(),
  spairport_airport_other_local_wireless_networks: z.array(Network).optional(),
});

const Profile = z.object({
  SPAirPortDataType: z.array(z.object({ spairport_airport_interfaces: z.array(WifiInterface).optional() })),
});

type RawNetwork = z.infer<typeof Network>;

const BANDS: Record<string, WifiBand> = { "2": "2.4", "2.4": "2.4", "5": "5", "6": "6" };

/** "36 (5GHz, 80MHz)" → channel 36, band 5, width 80. Older macOS omits the width, which means 20 MHz. */
export function parseChannel(text: string | undefined): { channel: number; band: WifiBand; widthMhz: number } | null {
  const m = /^(\d+)\s*\((\d(?:\.\d)?)\s*GHz(?:,\s*(\d+)\s*MHz)?\)/.exec(text ?? "");
  const band = m?.[2] ? BANDS[m[2]] : undefined;
  if (!m || !band) return null;
  return { channel: Number(m[1]), band, widthMhz: m[3] ? Number(m[3]) : 20 };
}

/** "-42 dBm / -92 dBm" → signal -42, noise -92. */
export function parseSignal(text: string | undefined): { signalDbm: number; noiseDbm: number } | null {
  const m = /(-?\d+)\s*dBm\s*\/\s*(-?\d+)\s*dBm/.exec(text ?? "");
  return m ? { signalDbm: Number(m[1]), noiseDbm: Number(m[2]) } : null;
}

const SECURITY_WORDS: Record<string, string> = { wpa: "WPA", wpa2: "WPA2", wpa3: "WPA3", wep: "WEP", personal: "Personal", enterprise: "Enterprise", mixed: "mixed", transition: "transition", owe: "Enhanced Open" };

const SECURITY_NAMES: Record<string, string> = {
  none: "Open",
  wpa2_personal_mixed: "WPA/WPA2 Personal",
  wpa_wpa2_personal: "WPA/WPA2 Personal",
  wpa3_transition: "WPA2/WPA3 Personal",
  wpa3_personal_transition: "WPA2/WPA3 Personal",
};

export function formatSecurity(mode: string | undefined): string | null {
  if (!mode) return null;
  const key = mode.replace(/^spairport_security_mode_/, "");
  if (key === "unknown") return null;
  if (SECURITY_NAMES[key]) return SECURITY_NAMES[key];
  return key
    .split("_")
    .map((w) => SECURITY_WORDS[w] ?? w)
    .join(" ");
}

const isHidden = (name: string | undefined): boolean => name === undefined || name === "<redacted>";

function toNetwork(raw: RawNetwork): WifiNetwork | null {
  const ch = parseChannel(raw.spairport_network_channel);
  if (!ch) return null;
  const sig = parseSignal(raw.spairport_signal_noise);
  return {
    ssid: isHidden(raw._name) ? null : (raw._name ?? null),
    ...ch,
    phy: raw.spairport_network_phymode ?? null,
    security: formatSecurity(raw.spairport_security_mode),
    signalDbm: sig?.signalDbm ?? null,
    noiseDbm: sig?.noiseDbm ?? null,
    snrDb: sig ? sig.signalDbm - sig.noiseDbm : null,
    txRateMbps: raw.spairport_network_rate ?? null,
    countryCode: raw.spairport_network_country_code ?? null,
  };
}

export function parseWifi(data: unknown, now = Date.now()): WifiInfo {
  const profile = parseUpstream("system_profiler", Profile, data);
  const interfaces = profile.SPAirPortDataType.flatMap((d) => d.spairport_airport_interfaces ?? []);
  // awdl0 (AirDrop) also appears; the real Wi-Fi card is the one that lists networks or reports a status.
  const wifi = interfaces.find((i) => i.spairport_airport_other_local_wireless_networks || i.spairport_status_information);
  if (!wifi) return { at: now, interface: null, connected: false, current: null, nearby: [], namesHidden: false };

  const connected = wifi.spairport_status_information === "spairport_status_connected";
  const rawCurrent = connected ? wifi.spairport_current_network_information : undefined;
  const rawNearby = wifi.spairport_airport_other_local_wireless_networks ?? [];
  const namesHidden = [rawCurrent, ...rawNearby].some((n) => n !== undefined && isHidden(n._name));

  return {
    at: now,
    interface: wifi._name,
    connected,
    current: rawCurrent ? toNetwork(rawCurrent) : null,
    nearby: rawNearby.map(toNetwork).filter((n): n is WifiNetwork => n !== null),
    namesHidden,
  };
}

export function readWifi(): Promise<WifiInfo> {
  return memo("net:wifi", 20_000, async () => {
    const output = await run(["system_profiler", "SPAirPortDataType", "-json"], { timeoutMs: 20_000 });
    let data: unknown;
    try {
      data = JSON.parse(output);
    } catch {
      throw new HttpError(502, "wifi_unreadable", "system_profiler did not return JSON for the Wi-Fi report");
    }
    return parseWifi(data);
  });
}

export function summarize(info: WifiInfo): WifiSummary | null {
  const c = info.current;
  if (!c) return null;
  return { ssid: c.ssid, channel: c.channel, band: c.band, widthMhz: c.widthMhz, signalDbm: c.signalDbm, snrDb: c.snrDb, txRateMbps: c.txRateMbps };
}

/** The Wi-Fi report if it is ready within `waitMs`, otherwise null. The scan keeps running and fills the cache for the next call. */
export async function wifiWithin(waitMs: number): Promise<WifiInfo | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), waitMs);
  });
  try {
    return await Promise.race([readWifi(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
