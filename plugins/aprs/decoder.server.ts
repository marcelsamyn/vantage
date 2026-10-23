import type { AprsPacket, AprsWeather } from "./types";

/** APRS UTC timestamps omit month/year or day; choose the nearest valid occurrence to receipt. */
export function packetTime(stamp: string, receivedAt: number): number | null {
  if (!/^\d{6}[zh]$/.test(stamp)) return null;
  const a = Number(stamp.slice(0, 2));
  const b = Number(stamp.slice(2, 4));
  const c = Number(stamp.slice(4, 6));
  const now = new Date(receivedAt);
  const candidates: number[] = [];
  if (stamp.endsWith("h")) {
    if (a > 23 || b > 59 || c > 59) return null;
    for (const day of [-1, 0, 1]) candidates.push(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + day, a, b, c));
  } else {
    if (a < 1 || a > 31 || b > 23 || c > 59) return null;
    for (const offset of [-1, 0, 1]) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      const at = Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), a, b, c);
      if (new Date(at).getUTCDate() === a) candidates.push(at);
    }
  }
  return candidates.sort((x, y) => Math.abs(x - receivedAt) - Math.abs(y - receivedAt))[0] ?? null;
}

interface Position {
  lat: number;
  lon: number;
  symbol: string;
  consumed: number;
  courseDeg?: number;
  speedKt?: number;
}

function position(text: string): Position | null {
  const plain = /^(\d{2})(\d{2}\.\d{2})([NS])([/\\A-Z0-9])(\d{3})(\d{2}\.\d{2})([EW])([!-~])/.exec(text);
  if (plain) {
    const [, latDeg, latMin, ns, table, lonDeg, lonMin, ew, symbol] = plain;
    if (Number(latMin) >= 60 || Number(lonMin) >= 60) return null;
    const lat = (Number(latDeg) + Number(latMin) / 60) * (ns === "S" ? -1 : 1);
    const lon = (Number(lonDeg) + Number(lonMin) / 60) * (ew === "W" ? -1 : 1);
    return validPosition(lat, lon) ? { lat, lon, symbol: `${table}${symbol}`, consumed: 19 } : null;
  }
  if (!/^[/\\A-Za-j][!-{]{8}[!-~][!-{]{3}/.test(text)) return null;
  const lat = 90 - base91(text.slice(1, 5)) / 380926;
  const lon = -180 + base91(text.slice(5, 9)) / 190463;
  if (!validPosition(lat, lon)) return null;
  const course = text.charCodeAt(10) - 33;
  const speed = text.charCodeAt(11) - 33;
  const compressionType = text.charCodeAt(12) - 33;
  // GGA compression encodes altitude in these bytes; range packets use course 90.
  const moving = (compressionType & 0x18) !== 0x10 && course < 90;
  return { lat, lon, symbol: text[0]! + text[9]!, consumed: 13, ...(moving ? { courseDeg: course * 4, speedKt: 1.08 ** speed - 1 } : {}) };
}

function base91(text: string): number {
  let value = 0;
  for (const char of text) value = value * 91 + char.charCodeAt(0) - 33;
  return value;
}

function validPosition(lat: number, lon: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
}

function micE(destination: string, text: string): Position | null {
  const call = destination.split("-")[0] ?? "";
  if (!/^[0-9A-JP-Y]{6}$/.test(call) || text.length < 9) return null;
  const digits = [...call].map((c) => c <= "9" ? Number(c) : c.charCodeAt(0) - (c <= "J" ? 65 : 80));
  const latMin = digits[2]! * 10 + digits[3]! + (digits[4]! * 10 + digits[5]!) / 100;
  if (latMin >= 60) return null;
  const lat = (digits[0]! * 10 + digits[1]! + latMin / 60) * (call[3]! >= "P" ? 1 : -1);
  const bytes = [...text.slice(1, 7)].map((c) => c.charCodeAt(0) - 28);
  if (bytes.some((b) => b < 0 || b > 99)) return null;
  let degrees = bytes[0]! + (call[4]! >= "P" ? 100 : 0);
  if (degrees >= 180 && degrees <= 189) degrees -= 80;
  else if (degrees >= 190 && degrees <= 199) degrees -= 190;
  let minutes = bytes[1]!;
  if (minutes >= 60) minutes -= 60;
  if (minutes >= 60) return null;
  const lon = (degrees + minutes / 60 + bytes[2]! / 6000) * (call[5]! >= "P" ? -1 : 1);
  if (!validPosition(lat, lon)) return null;
  let speedKt = bytes[3]! * 10 + Math.floor(bytes[4]! / 10);
  let courseDeg = bytes[4]! % 10 * 100 + bytes[5]!;
  if (speedKt >= 800) speedKt -= 800;
  if (courseDeg >= 400) courseDeg -= 400;
  if (courseDeg > 360) return null;
  return { lat, lon, symbol: text[8]! + text[7]!, consumed: 9, speedKt, courseDeg };
}

function weather(text: string): AprsWeather | null {
  const out: AprsWeather = {};
  const number = (pattern: RegExp): number | undefined => {
    const value = pattern.exec(text)?.[1];
    return value === undefined ? undefined : Number(value);
  };
  const temp = number(/t(-\d{2}|\d{3})/);
  const humidity = number(/h(\d{2})/);
  const pressure = number(/b(\d{5})/);
  const direction = number(/^(\d{3})\/\d{3}/) ?? number(/c(\d{3})/);
  const wind = number(/^\d{3}\/(\d{3})/) ?? number(/s(\d{3})/);
  const gust = number(/g(\d{3})/);
  const hour = number(/r(\d{3})/);
  const day = number(/p(\d{3})/);
  const midnight = number(/P(\d{3})/);
  if (temp !== undefined) out.temperatureC = (temp - 32) * 5 / 9;
  if (humidity !== undefined) out.humidityPct = humidity === 0 ? 100 : humidity;
  if (pressure !== undefined) out.pressureHpa = pressure / 10;
  if (direction !== undefined) out.windFromDeg = direction;
  if (wind !== undefined) out.windMps = wind * 0.44704;
  if (gust !== undefined) out.gustMps = gust * 0.44704;
  if (hour !== undefined) out.rainHourMm = hour * 0.254;
  if (day !== undefined) out.rainDayMm = day * 0.254;
  if (midnight !== undefined) out.rainMidnightMm = midnight * 0.254;
  return Object.keys(out).length ? out : null;
}

/** Decode TNC2 packets; unsupported or positionless reports keep raw details without inventing a location. */
export function decodePacket(raw: string, receivedAt: number): AprsPacket | null {
  const header = /^([A-Za-z0-9-]{1,9})>([^:>]+):(.*)$/s.exec(raw);
  if (!header) return null;
  const callsign = header[1]!;
  const route = header[2]!.split(",");
  const destination = route[0]!;
  if (!destination) return null;
  let body = header[3]!;
  const p: AprsPacket = {
    id: `station:${callsign}`, callsign, name: callsign, kind: "station", alive: true,
    lat: null, lon: null, symbol: null, receivedAt, reportedAt: null, timestamp: null,
    raw, destination, path: route.slice(1), comment: "", status: null,
    altitudeM: null, courseDeg: null, speedKt: null, weather: null, telemetry: null,
  };
  let pos: Position | null = null;
  const hasPosition = [";", ")", "`", "'", "!", "=", "/", "@"].includes(body[0] ?? "");
  if (body[0] === ";") {
    if (body.length < 18 || !/[*_]/.test(body[10] ?? "")) return p;
    p.kind = "object";
    p.name = body.slice(1, 10).trimEnd();
    p.alive = body[10] === "*";
    p.timestamp = body.slice(11, 18);
    body = body.slice(18);
  } else if (body[0] === ")") {
    const item = /^\)(.{3,9}?)([!_])/.exec(body);
    if (!item) return p;
    p.kind = "item";
    p.name = item[1]!;
    p.alive = item[2] === "!";
    body = body.slice(item[0].length);
  } else if (body[0] === "`" || body[0] === "'") {
    pos = micE(destination, body);
  } else if (body[0] === "!" || body[0] === "=") body = body.slice(1);
  else if (body[0] === "/" || body[0] === "@") {
    p.timestamp = body.slice(1, 8);
    body = body.slice(8);
  } else if (body[0] === ">") {
    const stamp = /^\d{6}[zh/]/.exec(body.slice(1));
    p.timestamp = stamp?.[0] ?? null;
    p.status = body.slice(1 + (stamp?.[0].length ?? 0));
  } else if (body.startsWith("T#")) {
    const telemetry = /^T#(\d{3}),([\d,]+),(\d{8})(?:,|$)/.exec(body);
    const analog = telemetry?.[2]?.split(",").map(Number);
    if (telemetry && analog?.length === 5 && /^[01]{8}$/.test(telemetry[3]!)) p.telemetry = { sequence: Number(telemetry[1]), analog, digital: telemetry[3]! };
  } else if (body[0] === "_") p.weather = weather(body.slice(9));
  else p.comment = body;
  if (p.kind !== "station") p.id = `${p.kind}:${p.name}`;
  if (p.timestamp) p.reportedAt = packetTime(p.timestamp, receivedAt);
  pos ??= hasPosition ? position(body) : null;
  if (!pos) return p;
  p.lat = pos.lat;
  p.lon = pos.lon;
  p.symbol = pos.symbol;
  p.comment = body.slice(pos.consumed);
  p.courseDeg = pos.courseDeg ?? null;
  p.speedKt = pos.speedKt ?? null;
  const motion = /^(\d{3})\/(\d{3})/.exec(p.comment);
  if (motion && !p.symbol.endsWith("_")) {
    if (Number(motion[1]) <= 360) p.courseDeg = Number(motion[1]);
    p.speedKt = Number(motion[2]);
  }
  const alt = /\/A=(-?\d{6})/.exec(p.comment);
  if (alt) p.altitudeM = Number(alt[1]) * 0.3048;
  if (p.symbol.endsWith("_")) p.weather = weather(p.comment);
  return p;
}
