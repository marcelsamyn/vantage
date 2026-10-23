import { ArrowUp, ChevronDown, SlidersHorizontal } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useId, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";
import { fmt } from "../../app/core/format";
import { turnDeg, useHeading } from "../../app/core/heading";
import { useLocation } from "../../app/core/location";
import { walkMinutes, type PlacedItem } from "../../app/core/nearby";
import { useSettings, type Units } from "../../app/core/settings";
import { ActionButton, Button, Empty, LiveDot, Scanning, Segmented, Sheet, Toggle, type SnapPoint } from "../../app/ui";
import { widerRadius } from "./around";
import { ItemIcon, chooseItem, whereWords } from "./around-items";
import { aroundSources } from "./around-sources";
import { AROUND_TABS, aroundItems, type AroundTab } from "./around-view";
import { useCity, useMutedNearby, type AroundData } from "./store";

const EMPTY_TITLE: Record<AroundTab, string> = {
  all: "Nothing found nearby",
  now: "Nothing happening nearby",
  go: "No departures or bikes nearby",
  find: "No water, toilets or Wi-Fi mapped nearby",
  do: "Nothing to do nearby",
  see: "Nothing to see nearby",
};

/**
 * Scroll the list so `row` shows. Not `scrollIntoView`: that also scrolls every clipped ancestor, the screen itself
 * included, and the City map would slide up out of its frame. Only the list's own scroller moves, and only as far
 * as the part of it on screen needs: a drawer's content runs on below the screen's edge.
 */
function revealRow(row: HTMLElement): void {
  const scroller = row.closest<HTMLElement>(".v-sheet__body") ?? row.closest<HTMLElement>(".city-near__body");
  if (!scroller) return;
  const box = scroller.getBoundingClientRect();
  const bottom = Math.min(box.bottom, row.closest(".v-sheet")?.getBoundingClientRect().bottom ?? box.bottom);
  const r = row.getBoundingClientRect();
  const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  if (r.top < box.top) scroller.scrollBy({ top: r.top - box.top, behavior });
  else if (r.bottom > bottom) scroller.scrollBy({ top: Math.min(r.top - box.top, r.bottom - bottom), behavior });
}

/** The phone sheet keeps the radius and filter button in reach while its list scrolls. */
function useAroundParts(map: MapLibreMap, onOpenFilters?: () => void): { head: ReactElement; body: ReactElement } {
  const around = useCity((s) => s.around);
  const selected = useCity((s) => s.selected);
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const tab = useCity((s) => s.aroundTab);
  const setTab = useCity((s) => s.setAroundTab);
  const expanded = useCity((s) => s.aroundExpanded);
  const muted = useMutedNearby();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersId = useId();
  const filters = useRef<HTMLDivElement>(null);
  const items = around?.items ?? [];
  const shown = aroundItems(items, tab, expanded);
  const count = (t: AroundTab): number => aroundItems(items, t, true).length;
  const remaining = count(tab) - shown.length;
  const radius = around ? fmt.distance(around.radiusM, units) : "";
  const activeFilter = tab === "all" ? "" : AROUND_TABS.find((t) => t.value === tab)?.label;
  const filterLabel = activeFilter ? `Filters · ${activeFilter}` : muted.size > 0 ? `Filters · ${muted.size} off` : "Filters";
  const openFilters = (): void => {
    setFiltersOpen(true);
    onOpenFilters?.();
  };

  // Keep the chosen row in view when it was chosen on the map.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const row = selected ? list.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(selected)}"]`) : null;
    if (row) revealRow(row);
  }, [selected]);
  useEffect(() => {
    if (filtersOpen && filters.current) revealRow(filters.current);
  }, [filtersOpen]);

  const head = (
    <div className="city-near__head">
      <div className="city-near__sub">
        {here && around && !around.settled ? (
          <Scanning label={`Looking within ${radius}`} />
        ) : (
          <span className="v-eyebrow">{here ? `Within ${radius} ${here.source === "manual" ? "of your pin" : "of you"}` : "Around you"}</span>
        )}
        <Button size="sm" variant="ghost" className="city-near__filter-button" icon={<SlidersHorizontal size={13} />} aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => filtersOpen ? setFiltersOpen(false) : openFilters()}>
          {filterLabel}
        </Button>
      </div>
    </div>
  );
  const body = (
    <div className="city-near__body">
      <div ref={filters} id={filtersId} className="city-near__filters" hidden={!filtersOpen}>
        <div className="city-near__tabs">
          <Segmented label="What to show" value={tab} onChange={setTab} options={AROUND_TABS.map((t) => ({ value: t.value, label: `${t.label} ${count(t.value)}` }))} />
        </div>
        <Sources around={around} />
      </div>
      {here?.source === "ip" && <p className="city-near__note">Your position comes from your internet address and can be a few kilometres off. Allow location for this site to see what is on your street.</p>}
      <Body map={map} around={around} shown={shown} tab={tab} units={units} selected={selected} list={list} locating={status === "locating"} hasPosition={here !== null} openFilters={openFilters} />
      {remaining > 0 && (
        <Button size="sm" variant="ghost" onClick={() => useCity.setState({ aroundExpanded: true })}>
          Show {remaining} more
        </Button>
      )}
      <Failures around={around} />
    </div>
  );
  return { head, body };
}

/** The "Around me" list in the desktop's left column. */
export function AroundList({ map }: { map: MapLibreMap }): ReactElement {
  const { head, body } = useAroundParts(map);
  return (
    <div className="city-near">
      {head}
      {body}
    </div>
  );
}

const DRAWER_SNAPS: readonly SnapPoint[] = ["peek", "half", "full"];
/** The first row under the header at the peek: enough to see the nearest thing without covering the map. */
const PEEK_ROW_PX = 78;

/** The phone's drawer peeks with the nearest thing and drags to half or the full list. */
export function AroundSheet({ map }: { map: MapLibreMap }): ReactElement {
  const { head, body } = useAroundParts(map, () => {
    // The peek has room for one result, but category and source choices need more room.
    useCity.setState((s) => s.drawer.snap === "peek" ? { drawer: { ...s.drawer, snap: "half" } } : s);
  });
  const snap = useCity((s) => s.drawer.snap);
  // Choosing a thing shows it on the map, so the drawer steps down to its peek.
  const selected = useCity((s) => s.selected);
  useEffect(() => {
    if (selected) useCity.setState((s) => ({ drawer: { ...s.drawer, snap: "peek" } }));
  }, [selected]);
  return (
    <Sheet
      label="Around me"
      className="city-drawer"
      snaps={DRAWER_SNAPS}
      snap={snap}
      onSnap={(next, shownPx, peekPx) => useCity.setState({ drawer: { snap: next, shownPx, peekPx } })}
      peekBody={PEEK_ROW_PX}
      head={head}
    >
      {body}
    </Sheet>
  );
}

function Body({
  map,
  around,
  shown,
  tab,
  units,
  selected,
  list,
  locating,
  hasPosition,
  openFilters,
}: {
  map: MapLibreMap;
  around: AroundData | null;
  shown: PlacedItem[];
  tab: AroundTab;
  units: Units;
  selected: string | null;
  list: RefObject<HTMLUListElement | null>;
  locating: boolean;
  hasPosition: boolean;
  openFilters: () => void;
}): ReactElement {
  const gps = useLocation((s) => s.here?.source === "gps");
  const heading = useHeading(gps);
  if (!hasPosition) {
    if (locating) {
      return (
        <div className="city-near__state">
          <Scanning label="Finding your position" />
        </div>
      );
    }
    return (
      <Empty title="Where are you?" action={<Button onClick={() => void useLocation.getState().locate()}>Locate me</Button>}>
        Around me needs your position to find what is within walking distance. Allow location for this site in your browser's address bar, then choose Locate me.
      </Empty>
    );
  }
  if (around?.providers.length === 0) {
    return <Empty title="Every source is off" action={<Button onClick={openFilters}>Change filters</Button>}>Open Sources in Filters and switch on a source.</Empty>;
  }
  if (shown.length === 0) {
    if (!around?.settled) {
      return (
        <div className="city-near__state">
          <Scanning label="Looking around you" />
        </div>
      );
    }
    const wider = widerRadius(around.radiusM);
    return (
      <Empty title={EMPTY_TITLE[tab]} action={wider ? <Button onClick={() => map.zoomOut({ duration: 500 })}>Look within {fmt.distance(wider, units)}</Button> : undefined}>
        {wider ? `Nothing within ${fmt.distance(around.radiusM, units)} of you.` : `Nothing within ${fmt.distance(around.radiusM, units)}, the widest search.`}
      </Empty>
    );
  }
  return (
    <ul ref={list} className="city-near__list">
      {shown.map((item) => (
        <Row key={item.key} map={map} item={item} units={units} chosen={item.key === selected} heading={heading} />
      ))}
    </ul>
  );
}

/** "in 4 min", "now", "until 18:40", "live". */
function timing(item: PlacedItem, now: number): string | null {
  if (item.startsAt !== undefined && item.startsAt > now) return fmt.until(item.startsAt, now);
  if (item.live) return "live";
  if (item.entity?.kind === "vehicle") return null;
  if (item.until !== undefined) return `until ${fmt.clock(item.until)}`;
  if (item.startsAt !== undefined) return "now";
  return null;
}

function Row({ map, item, units, chosen, heading }: { map: MapLibreMap; item: PlacedItem; units: Units; chosen: boolean; heading: number | null }): ReactElement {
  const when = timing(item, Date.now());
  const positioned = typeof item.at === "object";
  const relative = item.bearing !== null && heading !== null ? turnDeg(heading, item.bearing) : null;
  const arrow = relative ?? item.bearing;
  const direction = relative === null ? "" : `, ${Math.round(Math.abs(relative))}° ${relative < 0 ? "left" : "right"} of where your phone points`;
  return (
    <li className="city-near__item" data-key={item.key} data-tone={item.tone} data-chosen={chosen || undefined}>
      <button type="button" className="city-near__hit" aria-label={`${item.title}, ${whereWords(item, units)}${direction}. ${item.detail}`} aria-current={chosen || undefined} onClick={() => chooseItem(map, item)} />
      <span className="city-near__icon" aria-hidden>
        {item.image ? <img src={item.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <ItemIcon icon={item.icon} size={16} />}
        {item.image && (
          <span className="city-near__badge">
            <ItemIcon icon={item.icon} size={10} />
          </span>
        )}
      </span>
      <span className="city-near__text" aria-hidden>
        <span className="city-near__title">{item.title}</span>
        <span className="city-near__detail">
          {item.urgency === "now" && item.live !== false && <LiveDot tone={item.tone === "fog" ? "sodium" : item.tone} live={false} />}
          {when && <span className={`city-near__when city-near__when--${item.urgency}`}>{when}</span>}
          <span className="city-near__what">{item.detail}</span>
        </span>
      </span>
      <span className="city-near__where num" aria-hidden>
        <span className="city-near__bearing">
          {positioned && arrow !== null && <ArrowUp size={14} style={{ rotate: `${arrow}deg` }} />}
          {positioned ? fmt.distance(item.distanceM, units) : item.at === "overhead" ? "Overhead" : "Here"}
        </span>
        {positioned && item.entity?.kind !== "vehicle" && <small>{Math.max(1, Math.round(walkMinutes(item.distanceM)))} min walk</small>}
      </span>
      <span className="city-near__act">
        <ActionButton action={item.primary} />
      </span>
      {chosen && item.more && item.more.length > 0 && (
        <span className="city-near__more">
          {item.more.map((a) => (
            <ActionButton key={a.label} action={a} quiet />
          ))}
        </span>
      )}
    </li>
  );
}

/** A provider that failed says so quietly, below the list; the others carry on. */
function Failures({ around }: { around: AroundData | null }): ReactElement | null {
  const failed = around?.providers.filter((p) => p.error) ?? [];
  if (failed.length === 0) return null;
  return (
    <div className="city-near__fails">
      {failed.map((p) => (
        <p key={p.id}>
          <span>{p.title}</span> {p.error}
        </p>
      ))}
      <Button size="sm" variant="ghost" onClick={() => around?.refresh()}>
        Ask again
      </Button>
    </div>
  );
}

/**
 * Source choices stay folded within Filters. A switched-off provider is not asked at all.
 */
function Sources({ around }: { around: AroundData | null }): ReactElement {
  const all = useMemo(aroundSources, []);
  const muted = useMutedNearby();
  const toggle = useCity((s) => s.toggleNearby);
  const [open, setOpen] = useState(false);
  const on = all.filter((s) => !muted.has(s.id)).length;
  return (
    <div className="city-near__sources">
      <button type="button" className="city-near__fold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="v-eyebrow">Sources</span>
        <span className="v-eyebrow city-near__on">
          {on}/{all.length} on
        </span>
        <ChevronDown size={14} style={{ rotate: open ? "0deg" : "-90deg" }} aria-hidden />
      </button>
      {open &&
        all.map((source) => {
          const status = around?.providers.find((p) => p.id === source.id);
          // What it put in the list, which is what you see: the provider's own answer can reach past the radius.
          const shown = around?.items.filter((i) => i.source === source.id).length ?? 0;
          const count = !status ? undefined : status.error ? "error" : status.loading && shown === 0 ? "…" : fmt.int(shown);
          return (
            <div key={source.id} title={status?.error ?? source.attribution ?? source.title}>
              <Toggle checked={!muted.has(source.id)} onChange={(v) => toggle(source.id, v)} label={source.title} count={count} />
            </div>
          );
        })}
    </div>
  );
}
