export interface WifiNetwork {
  ssid: string;
  /** "WPA", "WEP" or "nopass", as written in the code. */
  security: string;
  password: string;
  hidden: boolean;
}

const SPECIAL = /[\\;,":]/g;
const escapeField = (v: string): string => v.replace(SPECIAL, "\\$&");

/** Parse the common `WIFI:T:WPA;S:name;P:pass;H:true;;` payload. Returns null for anything else. */
export function parseWifi(text: string): WifiNetwork | null {
  if (!/^WIFI:/i.test(text)) return null;
  const fields: Record<string, string> = {};
  let key = "";
  let value = "";
  let inValue = false;
  const body = text.slice(5);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    if (ch === "\\" && i + 1 < body.length) {
      const next = body[++i] ?? "";
      if (inValue) value += next;
      else key += next;
    } else if (!inValue && ch === ":") {
      inValue = true;
    } else if (ch === ";") {
      if (key) fields[key.toUpperCase()] = value;
      key = "";
      value = "";
      inValue = false;
    } else if (inValue) value += ch;
    else key += ch;
  }
  if (key) fields[key.toUpperCase()] = value;
  const ssid = fields.S;
  if (ssid === undefined) return null;
  return { ssid, security: (fields.T ?? "nopass").toUpperCase() === "NOPASS" ? "nopass" : (fields.T ?? "nopass").toUpperCase(), password: fields.P ?? "", hidden: (fields.H ?? "").toLowerCase() === "true" };
}

export function buildWifi(net: WifiNetwork): string {
  const parts = [`T:${net.security}`, `S:${escapeField(net.ssid)}`];
  if (net.security !== "nopass") parts.push(`P:${escapeField(net.password)}`);
  if (net.hidden) parts.push("H:true");
  return `WIFI:${parts.join(";")};;`;
}

export function describeSecurity(security: string): string {
  if (security === "nopass") return "Open network, no password";
  if (security === "WEP") return "WEP (outdated, easy to break)";
  if (security === "SAE") return "WPA3";
  return "WPA / WPA2";
}
