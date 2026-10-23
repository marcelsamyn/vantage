/** Exponential delay for the nth consecutive failure (1 = first): `baseMs`, then double each time, never above `capMs`. */
export function backoffMs(failures: number, baseMs: number, capMs: number): number {
  const exponent = Math.max(0, Math.min(failures - 1, 30));
  return Math.min(capMs, baseMs * 2 ** exponent);
}
