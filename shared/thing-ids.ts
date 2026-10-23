/**
 * Identifiers that name one real object in a register several sources share, written "<scheme>:<value>":
 * "osm:node/123", "wikidata:Q42", "uic:8814001". A source of things on the map puts every one its record carries in
 * the thing's `match`. Two reports that share one are the same thing; two that give different values in one scheme are
 * two things, however close they stand. Position only decides between reports that carry no identifier in common.
 *
 * The helpers below write each scheme one way, so the same charger or station reads the same from every source. Each
 * takes a raw value as a register or a tag holds it, with several separated by ";" as OpenStreetMap writes them, and
 * returns only the ones that fit the scheme. A scheme of your own is fine: lowercase, and the same in every source.
 */
export type ThingId = `${string}:${string}`;

const values = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(";")
    .map((v) => v.trim())
    .filter(Boolean);

/** An OpenStreetMap element, "node/123". */
export const osmId = (ref: string): ThingId => `osm:${ref}`;

/** Wikidata items: "Q42". */
export const wikidataIds = (raw: string | undefined): ThingId[] => values(raw).flatMap((v): ThingId[] => (/^Q[1-9]\d*$/i.test(v) ? [`wikidata:${v.toUpperCase()}`] : []));

/** UIC station codes: two digits for the country, five for the station, "8814001". */
export const uicIds = (raw: string | undefined): ThingId[] => values(raw).flatMap((v): ThingId[] => (/^\d{7}$/.test(v) ? [`uic:${v}`] : []));

/**
 * IFOPT stop places: country, area and place, "de:08111:6115". A code that goes on to a platform is cut back to its
 * stop place, so a register of platforms and a register of stations name the same station.
 */
export const ifoptIds = (raw: string | undefined): ThingId[] =>
  values(raw).flatMap((v): ThingId[] => {
    const [country, area, place] = v.split(":");
    return country && area && place && /^[a-z]{2}$/i.test(country) ? [`ifopt:${country.toLowerCase()}:${area}:${place}`] : [];
  });

/** Charge point (EVSE) IDs as eMI3 writes them, "DE*ABC*E123*1", with or without the stars. */
export const evseIds = (raw: string | undefined): ThingId[] =>
  values(raw).flatMap((v): ThingId[] => {
    const plain = v.replaceAll("*", "").toUpperCase();
    return /^[A-Z]{2}[A-Z0-9]{3}E[A-Z0-9]+$/.test(plain) ? [`evse:${plain}`] : [];
  });

/** The scheme of an identifier: "osm" for "osm:node/123". */
export const schemeOf = (id: ThingId): string => id.slice(0, id.indexOf(":"));
