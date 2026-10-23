import type { WifiLanguage } from "./types";

const NAMES = new Intl.DisplayNames("en", { type: "language" });

/** "it" becomes "Italian". Codes the browser does not know stay as the city wrote them. */
export function languageName(code: string): string {
  try {
    return NAMES.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "62 % Italian, 21 % English". */
export function languageMix(languages: readonly WifiLanguage[]): string {
  return languages.map((l) => `${Math.round(l.share * 100)} % ${languageName(l.code)}`).join(", ");
}
