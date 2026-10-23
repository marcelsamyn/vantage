/**
 * Who the register credits. ArCo names the designer or workshop behind an object; that name is shown as
 * the register gives it, and the wider workshop or scope stands in only when there is no name.
 */

const titleCase = (s: string): string => s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep: string, ch: string) => sep + ch.toUpperCase());

/** The named author the register credits, or the workshop or cultural scope when it names no one. */
export function creditedAuthor(named: string | undefined, scope: string | undefined): string | null {
  if (named?.trim()) return named.trim();
  return scope?.trim() ? titleCase(scope.trim()) : null;
}
