/**
 * Local safety readout for a link found in a QR code. It only reads the text of the link.
 * Nothing is fetched and nothing is looked up, so "Looks ordinary" means "no warning signs in the text".
 */

export type Verdict = "ordinary" | "careful" | "phishing";

export interface Reason {
  tone: "mint" | "sodium" | "alarm";
  text: string;
}

export interface UrlReport {
  /** The link as it will open (a bare "example.com/x" gets https:// added). */
  href: string;
  host: string;
  /** Host with punycode labels decoded, when that differs from `host`. */
  unicodeHost: string | null;
  scheme: string;
  verdict: Verdict;
  reasons: Reason[];
}

const SHORTENERS = new Set([
  "bit.ly", "bitly.com", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "buff.ly", "rebrand.ly", "cutt.ly",
  "shorturl.at", "tiny.cc", "rb.gy", "t.ly", "lnkd.in", "bit.do", "v.gd", "s.id", "qr.ae", "adf.ly", "shorte.st",
]);

/** Brand name → registrable domains that really belong to it. */
const BRANDS: Record<string, readonly string[]> = {
  paypal: ["paypal.com", "paypal.me"],
  apple: ["apple.com", "icloud.com"],
  icloud: ["icloud.com", "apple.com"],
  google: ["google.com", "gmail.com", "youtube.com", "goo.gl"],
  microsoft: ["microsoft.com", "live.com", "office.com", "outlook.com", "microsoftonline.com"],
  amazon: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.fr", "amazon.nl", "amazonaws.com"],
  netflix: ["netflix.com"],
  facebook: ["facebook.com", "fb.com"],
  instagram: ["instagram.com"],
  whatsapp: ["whatsapp.com", "whatsapp.net"],
  linkedin: ["linkedin.com"],
  dropbox: ["dropbox.com"],
  coinbase: ["coinbase.com"],
  binance: ["binance.com"],
  chase: ["chase.com"],
  wellsfargo: ["wellsfargo.com"],
  bankofamerica: ["bankofamerica.com"],
  hsbc: ["hsbc.com", "hsbc.co.uk"],
  barclays: ["barclays.co.uk", "barclays.com"],
  dhl: ["dhl.com", "dhl.de"],
  fedex: ["fedex.com"],
  ups: ["ups.com"],
  usps: ["usps.com"],
  docusign: ["docusign.com", "docusign.net"],
};

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu"]);

/** Registrable domain without a public suffix list: the last two labels, or three under a country second level such as co.uk. */
function registrableLabels(labels: string[]): number {
  if (labels.length < 3) return labels.length;
  const tld = labels[labels.length - 1] ?? "";
  const second = labels[labels.length - 2] ?? "";
  return tld.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
}

// ── Punycode (RFC 3492), decode only ──────────────────────────────

function decodePunycode(input: string): string {
  const base = 36;
  const out: number[] = [];
  const lastDash = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(0, lastDash); j++) out.push(input.charCodeAt(j));
  let n = 128;
  let bias = 72;
  let i = 0;
  const digit = (c: number): number => (c >= 48 && c < 58 ? c - 22 : c >= 65 && c < 91 ? c - 65 : c >= 97 && c < 123 ? c - 97 : base);
  const adapt = (delta: number, points: number, first: boolean): number => {
    let d = first ? Math.floor(delta / 700) : delta >> 1;
    d += Math.floor(d / points);
    let k = 0;
    for (; d > ((base - 1) * 26) >> 1; k += base) d = Math.floor(d / (base - 1));
    return Math.floor(k + ((base) * d) / (d + 38));
  };
  for (let idx = lastDash > 0 ? lastDash + 1 : 0; idx < input.length; ) {
    const oldI = i;
    for (let w = 1, k = base; ; k += base) {
      if (idx >= input.length) return input;
      const d = digit(input.charCodeAt(idx++));
      if (d >= base) return input;
      i += d * w;
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
      if (d < t) break;
      w *= base - t;
    }
    const len = out.length + 1;
    bias = adapt(i - oldI, len, oldI === 0);
    n += Math.floor(i / len);
    i %= len;
    out.splice(i++, 0, n);
  }
  return String.fromCodePoint(...out);
}

export function toUnicodeHost(host: string): string {
  return host
    .split(".")
    .map((label) => (label.toLowerCase().startsWith("xn--") ? decodePunycode(label.slice(4)) : label))
    .join(".");
}

function scriptsIn(label: string): Set<string> {
  const found = new Set<string>();
  for (const ch of label) {
    if (/\p{Script=Latin}/u.test(ch)) found.add("Latin");
    else if (/\p{Script=Cyrillic}/u.test(ch)) found.add("Cyrillic");
    else if (/\p{Script=Greek}/u.test(ch)) found.add("Greek");
    else if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(ch)) found.add("CJK");
    else if (/\p{Script=Arabic}|\p{Script=Hebrew}/u.test(ch)) found.add("Arabic or Hebrew");
  }
  return found;
}

const DANGEROUS_SCHEMES = new Set(["javascript:", "data:", "vbscript:", "file:", "blob:"]);

/** The part of a QR payload that looks like a web address, or null when it is not a link. */
export function parseLink(text: string): URL | null {
  const trimmed = text.trim();
  if (/\s/.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "http:" || url.protocol === "https:" || DANGEROUS_SCHEMES.has(url.protocol)) return url;
    return null;
  } catch {
    // "www.example.com/path" is a link people expect to open, even without a scheme.
    if (/^[^\s/@:]+\.[a-z]{2,}(?::\d+)?(?:[/?#]\S*)?$/i.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export function inspectUrl(text: string): UrlReport | null {
  const url = parseLink(text);
  if (!url) return null;
  const raw = text.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^\s/@]+\.[a-z]{2,}:\d+/i.test(raw);
  const reasons: Reason[] = [];
  let score = 0;
  let severe = false;
  const add = (tone: Reason["tone"], weight: number, reasonText: string): void => {
    reasons.push({ tone, text: reasonText });
    score += weight;
    if (tone === "alarm") severe = true;
  };

  if (DANGEROUS_SCHEMES.has(url.protocol)) {
    add("alarm", 5, `This is a "${url.protocol.slice(0, -1)}:" address. It runs code or reads local data instead of opening a website.`);
    return { href: raw, host: "", unicodeHost: null, scheme: url.protocol.slice(0, -1), verdict: "phishing", reasons };
  }

  const host = url.hostname.toLowerCase();
  const unicodeHost = toUnicodeHost(host);
  const labels = host.split(".");
  const uLabels = unicodeHost.split(".");

  if (!hasScheme) add("sodium", 1, "The code has no scheme. VANTAGE assumes https.");
  else if (url.protocol === "https:") reasons.push({ tone: "mint", text: "Uses https, so the connection is encrypted." });
  else add("sodium", 2, "Uses http, not https. Anything you type on the page can be read on the way.");

  if (labels.some((l) => l.startsWith("xn--"))) {
    add("sodium", 2, `The host uses international characters (punycode). It displays as "${unicodeHost}".`);
  }
  const mixed = uLabels.map((l) => scriptsIn(l)).find((s) => s.size > 1);
  if (mixed) add("alarm", 4, `One part of the host mixes ${[...mixed].join(" and ")} letters, a common way to fake a familiar name.`);

  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (ipv4 || host.startsWith("[")) add("sodium", 2, "The address is a raw IP number, not a name. Real services rarely use one in a QR code.");

  const registrable = ipv4 || host.startsWith("[") ? host : labels.slice(-registrableLabels(labels)).join(".");
  if (SHORTENERS.has(registrable)) add("sodium", 2, `${registrable} is a link shortener. It hides where the link really goes.`);

  if (url.username || url.password) {
    add("alarm", 4, `The text before "@" is not the website. The link goes to ${host}.`);
  } else if (raw.includes("@")) {
    add("sodium", 1, 'The link contains an "@" sign.');
  }

  const subLabels = labels.length - registrableLabels(labels);
  if (!ipv4 && subLabels >= 4) add("sodium", 2, `The host has ${subLabels} subdomain levels, which can bury the real domain.`);

  if (!ipv4 && !host.startsWith("[")) {
    const domainLabel = labels[labels.length - registrableLabels(labels)] ?? "";
    const subdomains = labels.slice(0, labels.length - registrableLabels(labels));
    for (const [brand, owned] of Object.entries(BRANDS)) {
      if (owned.includes(registrable)) continue;
      if (subdomains.some((l) => l.includes(brand))) {
        add("alarm", 4, `The name "${brand}" appears in the address, but the site belongs to ${registrable}.`);
        break;
      }
      if (domainLabel.includes(brand)) {
        add("alarm", 3, `${registrable} looks like a copy of "${brand}" but is not owned by it.`);
        break;
      }
    }
  }

  const verdict: Verdict = severe || score >= 5 ? "phishing" : score >= 1 ? "careful" : "ordinary";
  if (verdict === "ordinary" && reasons.length === 0) reasons.push({ tone: "mint", text: "No warning signs in the text of the link." });
  return { href: hasScheme ? raw : url.href, host, unicodeHost: unicodeHost !== host ? unicodeHost : null, scheme: url.protocol.slice(0, -1), verdict, reasons };
}

export const VERDICT_TEXT: Record<Verdict, { label: string; tone: "mint" | "sodium" | "alarm" }> = {
  ordinary: { label: "Looks ordinary", tone: "mint" },
  careful: { label: "Be careful", tone: "sodium" },
  phishing: { label: "Likely phishing", tone: "alarm" },
};
