import type { Sighting } from "./types";

/** A position known only to within this many metres is drawn as its area: a dot would claim a spot. */
const WIDE_M = 1_000;

/** Whether a sighting is drawn as the area that holds it. Such a post never becomes a dot or a photo pin. */
export function isApproximate(post: Sighting): boolean {
  return post.detail.approximate || (post.uncertaintyM ?? 0) > WIDE_M;
}
