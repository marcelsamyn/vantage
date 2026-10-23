import type { Map as MapLibreMap } from "maplibre-gl";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { NearbyIcon, PlacedItem } from "../../app/core/nearby";
import { profile } from "../../app/core/profile";
import type { Units } from "../../app/core/settings";
import { Glyph } from "../../app/ui";
import { compassWords, inside, markArea } from "./around";
import { useCity } from "./store";

/** Event data that marks a camera move as the user's own navigation, so following stands down. */
const USER_NAVIGATION = { userNavigation: true } as const;

const isGlyph = (icon: NearbyIcon): icon is Extract<NearbyIcon, readonly unknown[]> => Array.isArray(icon);

export function ItemIcon({ icon, size }: { icon: NearbyIcon; size: number }): ReactElement {
  if (isGlyph(icon)) return <Glyph glyph={icon} size={size} />;
  // SVG markup carries its own colours for the map; as a mask it takes the item's tone like every other icon.
  if (typeof icon === "string") return <span className="city-svg-icon" style={{ width: size, height: size, maskImage: `url("data:image/svg+xml,${encodeURIComponent(icon)}")` }} aria-hidden />;
  const Icon = icon;
  return <Icon size={size} strokeWidth={1.75} aria-hidden />;
}

/** "230 m north-east", "overhead", "where you are". */
export function whereWords(item: PlacedItem, units: Units): string {
  if (item.at === "overhead") return "overhead";
  if (item.at === "here") return "where you are";
  return `${fmt.distance(item.distanceM, units)} ${compassWords(item.bearing ?? 0)}`;
}

/** What a screen reader says for a marker or pip: "Bike share Piazza Navona, 230 m north-east". */
export const itemLabel = (item: PlacedItem, units: Units): string => `${item.title}, ${whereWords(item, units)}`;

/** Fly to an item off screen and choose it. Following stops, so the map stays where you looked. */
export function focusItem(map: MapLibreMap, item: PlacedItem): void {
  useCity.setState({ selected: item.key, following: false });
  if (typeof item.at !== "object") return;
  map.flyTo({ center: [item.at.lon, item.at.lat], duration: 900, essential: true }, USER_NAVIGATION);
}

/** Choose an item from the list or the map: mark it, bring it into view, and open its profile when it has one. */
export function chooseItem(map: MapLibreMap, item: PlacedItem): void {
  const frame = useCity.getState().frame;
  const at = typeof item.at === "object" ? item.at : null;
  // Shown means drawn as a marker; a thing at the edge of the view is a pip and gets brought into view.
  const shown = at && frame ? inside(map.project([at.lon, at.lat]), markArea(frame)) : true;
  if (shown) useCity.setState({ selected: item.key });
  else focusItem(map, item);
  if (item.entity) profile.open(item.entity);
}
