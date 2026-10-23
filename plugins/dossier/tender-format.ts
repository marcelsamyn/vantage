import type { Tender } from "./types";

const DAY_MS = 86_400_000;

/** "€284 k", "€21.6 M": the size is what matters at a glance, the cents never do. */
export function money(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currency ?? "EUR", notation: "compact", maximumFractionDigits: value >= 1_000_000 ? 1 : 0 }).format(value);
  } catch {
    // An unknown currency code: say the amount with the code the notice gave.
    return `${new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value)} ${currency ?? ""}`.trim();
  }
}

const dayWords = (iso: string): string => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", day: "numeric", month: "short" });

/** Days from `today` (an ISO date) to `iso`, negative once past. */
export const daysBetween = (today: string, iso: string): number => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);

/** When offers are due: "closes today", "closes in 12 days (22 Oct)", "closed 3 Oct". */
export function deadlineWords(deadline: string | null, today: string): string | null {
  if (!deadline) return null;
  const days = daysBetween(today, deadline);
  if (days < 0) return `closed ${dayWords(deadline)}`;
  if (days === 0) return "closes today";
  return `closes in ${days} ${days === 1 ? "day" : "days"} (${dayWords(deadline)})`;
}

/** The notices with a stated value, largest first. */
export const biggest = (tenders: readonly Tender[], count: number): Tender[] =>
  tenders
    .filter((t) => t.value !== null)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, count);
