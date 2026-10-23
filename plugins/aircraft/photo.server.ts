import { webUrl, z } from "../../server/kit";
import type { AircraftPhoto } from "./types";

/**
 * Airframe photos. Planespotters.net's public photo API asks for: the photographer's name next to each photo, the
 * photo linked to its page with the `link` it returns, images loaded by the viewer's browser from its own URLs, and
 * answers cached for at most 24 hours. adsbdb passes on a photo from Airport-Data.com, whose page the file name names.
 */

/** Hosts the photo sources serve images from. A feed entry (adsbdb's is community-edited) must not make the browser contact any other host. */
const IMAGE_HOSTS = ["plnspttrs.net", "airport-data.com"];

/** `value` when it is an http(s) image address on one of the photo sources' hosts, otherwise null. */
export function imageUrl(value: string | null | undefined): string | null {
  const url = webUrl(value);
  if (!url) return null;
  const { hostname } = new URL(url);
  return IMAGE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`)) ? url : null;
}

const PsImage = z.object({ src: z.string() });
export const PlanespottersAnswer = z.object({
  photos: z.array(
    z.object({
      thumbnail: PsImage,
      thumbnail_large: PsImage.optional(),
      link: z.string(),
      photographer: z.string(),
    }),
  ),
});

/** The first photo in a Planespotters answer whose image is on a Planespotters host and whose page is a web address, or null when there is none. */
export function planespottersPhoto(answer: z.infer<typeof PlanespottersAnswer>): AircraftPhoto | null {
  for (const p of answer.photos) {
    const thumb = imageUrl(p.thumbnail.src);
    const link = webUrl(p.link);
    if (!thumb || !link) continue;
    return { src: imageUrl(p.thumbnail_large?.src) ?? thumb, thumb, photographer: p.photographer.trim() || null, source: "Planespotters.net", link };
  }
  return null;
}

/** Airport-Data.com names image files after the photo id, and shows each photo at /aircraft/photo/<id>. */
function airportDataPage(image: string): string | null {
  const url = new URL(image);
  if (url.hostname !== "airport-data.com" && !url.hostname.endsWith(".airport-data.com")) return null;
  const id = /\/(\d{1,12})\.jpg$/i.exec(url.pathname)?.[1];
  return id ? `https://airport-data.com/aircraft/photo/${id}` : null;
}

/** adsbdb's photo fields as a photo, or null when neither is an image on an Airport-Data.com host. */
export function adsbdbPhoto(fields: { url_photo?: string | null; url_photo_thumbnail?: string | null } | null): AircraftPhoto | null {
  const full = imageUrl(fields?.url_photo);
  const small = imageUrl(fields?.url_photo_thumbnail);
  const src = full ?? small;
  if (!src) return null;
  return { src, thumb: small ?? src, photographer: null, source: "Airport-Data.com", link: airportDataPage(src) };
}
