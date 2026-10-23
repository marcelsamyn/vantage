import type { ReactElement, ReactNode } from "react";
import type { AircraftPhoto } from "./types";
import "./aircraft.css";

/** "© Jan Peeters · Planespotters.net", or the source alone when it names no photographer. */
export function credit(photo: AircraftPhoto): string {
  return photo.photographer ? `© ${photo.photographer} · ${photo.source}` : `Photo · ${photo.source}`;
}

/**
 * Planespotters asks for a plain link to the photo's page, without nofollow or similar, so these anchors carry only
 * `noopener`. The page shows the photo full size with the photographer's details.
 */
function PhotoLink({ photo, className, children }: { photo: AircraftPhoto; className: string; children: ReactNode }): ReactElement {
  if (!photo.link) return <span className={className}>{children}</span>;
  return (
    <a className={className} href={photo.link} target="_blank" rel="noopener" title={`Open the full photo on ${photo.source}`}>
      {children}
    </a>
  );
}

/** The photo across the top of the profile, with its credit. A click opens it full size at its source. */
export function PhotoHeader({ photo, alt }: { photo: AircraftPhoto; alt: string }): ReactElement {
  return (
    <figure className="aircraft-photo">
      <PhotoLink photo={photo} className="aircraft-photo__frame">
        <img src={photo.src} alt={alt} loading="lazy" decoding="async" />
      </PhotoLink>
      <figcaption>
        <PhotoLink photo={photo} className="aircraft-photo__credit">
          {credit(photo)}
        </PhotoLink>
      </figcaption>
    </figure>
  );
}

/** A small photo for a list row. The row shows the credit next to it. */
export function PhotoThumb({ photo, alt }: { photo: AircraftPhoto; alt: string }): ReactElement {
  return (
    <PhotoLink photo={photo} className="aircraft-thumb">
      <img src={photo.thumb} alt={alt} loading="lazy" decoding="async" />
    </PhotoLink>
  );
}
