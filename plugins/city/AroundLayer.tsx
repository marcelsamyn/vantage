import { ChevronRight } from "lucide-react";
import type { EaseToOptions, Map as MapLibreMap, PaddingOptions } from "maplibre-gl";
import { memo, Suspense, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { contributions, lazyView, type Contributed } from "../../app/core/plugin";
import { Boundary } from "../../app/ui";
import { fmt } from "../../app/core/format";
import { useCompass, useHeading } from "../../app/core/heading";
import { useLocation, useWatchLocation, type Here } from "../../app/core/location";
import { useNearby, type PlacedItem } from "../../app/core/nearby";
import { useSettings } from "../../app/core/settings";
import { destination } from "../../shared/geo";
import { aroundSources } from "./around-sources";
import { aroundItems } from "./around-view";
import { STEP, TURN } from "./Facing";
import { AROUND_ZOOM, inside, layoutPips, markArea, pipSize, radiusForZoom, stablePipKeys, type Pip, type PipInput, type Rect } from "./around";
import { ItemIcon, chooseItem, focusItem, itemLabel } from "./around-items";
import { MAP_INK, useGeoJsonLayer, useTapTargets } from "./layer-kit";
import { useZoom } from "./LayerHost";
import { useCity, useMutedNearby } from "./store";

/** Pitch for "Around me": enough depth to read the street, flat enough to read the markers. */
const AROUND_PITCH = 40;
const NO_PADDING: PaddingOptions = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * "Around me": asks every provider in `aroundSources` about the area around you, keeps the map on you, and draws what it finds:
 * markers for things in view and pips on the edge for things within reach but off screen. The list reads the same
 * results from the City store.
 */
export function AroundLayer({ map }: { map: MapLibreMap }): ReactElement {
  const here = useLocation((s) => s.here);
  // A pinned position stays where you put it, so watching the GPS would only cost battery.
  useWatchLocation(here?.source !== "manual");
  const frame = useCity((s) => s.frame);
  const arrived = useFollow(map, here, frame);
  // Until the camera reaches the walking scale, ask about the radius it is heading for, not the one it passes.
  const zoom = useZoom(map);
  const radiusM = radiusForZoom(arrived ? zoom : AROUND_ZOOM);
  const all = useMemo(aroundSources, []);
  const muted = useMutedNearby();
  // A kind of thing reads the map's source switches when asked, so a change there asks every provider again.
  const mapMuted = useCity((s) => s.mutedSources);
  const sources = useMemo(() => all.filter((s) => !muted.has(s.id)), [all, muted, mapMuted]); // eslint-disable-line react-hooks/exhaustive-deps
  const nearby = useNearby(here, radiusM, sources);
  const tab = useCity((s) => s.aroundTab);
  const expanded = useCity((s) => s.aroundExpanded);
  const shown = useMemo(() => aroundItems(nearby.items, tab, expanded), [nearby.items, tab, expanded]);

  useEffect(() => {
    useCity.setState({ around: { ...nearby, radiusM } });
  }, [nearby.items, nearby.providers, nearby.settled, nearby.refresh, radiusM]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => useCity.setState({ around: null, selected: null, following: false }), []);

  // Clear a selection when it leaves the current view.
  const selected = useCity((s) => s.selected);
  useEffect(() => {
    if (selected && !shown.some((i) => i.key === selected)) useCity.setState({ selected: null });
  }, [selected, shown]);

  useRadiusRing(map, here, radiusM);
  return <Marks map={map} frame={frame} items={shown} here={here} />;
}

// ── Following you ─────────────────────────────────────────────────

/**
 * Follow you and keep you in the middle of the free area, north up or turned the way you face. True once the camera
 * has reached the walking scale.
 */
function useFollow(map: MapLibreMap, here: Here | null, frame: Rect | null): boolean {
  const following = useCity((s) => s.following);
  const facing = useCompass((s) => s.enabled);
  const heading = useHeading(following && facing && here?.source === "gps");

  // Start on you at walking scale; stop following when you pan or search, and give the map back its padding on exit.
  useEffect(() => {
    useCity.setState({ following: true });
    const stop = (): void => useCity.setState({ following: false });
    // A drag, the arrow keys, a search or a flight to something you chose: you are looking elsewhere now.
    const onMove = (e: { originalEvent?: unknown; userNavigation?: boolean }): void => {
      const panKey = e.originalEvent instanceof KeyboardEvent && e.originalEvent.key.startsWith("Arrow") && !e.originalEvent.shiftKey;
      if (e.userNavigation || panKey) stop();
    };
    map.on("dragstart", stop);
    map.on("movestart", onMove);
    return () => {
      map.off("dragstart", stop);
      map.off("movestart", onMove);
      // The map may already be gone when City itself closes or rebuilds it.
      if (map.style) map.easeTo({ padding: NO_PADDING, duration: 400 });
    };
  }, [map]);

  // While following, a pinch or a scroll zooms around you, not around the fingers.
  useEffect(() => {
    if (!following) return;
    const around = { around: "center" } as const;
    map.scrollZoom.disable();
    map.scrollZoom.enable(around);
    map.touchZoomRotate.disable();
    map.touchZoomRotate.enable(around);
    return () => {
      if (!map.style) return;
      map.scrollZoom.disable();
      map.scrollZoom.enable();
      map.touchZoomRotate.disable();
      map.touchZoomRotate.enable();
    };
  }, [map, following]);

  // The walking scale holds until the camera gets there: a later move (a new fix, the frame settling) would otherwise
  // cut the first ease short halfway. Your own zoom or tilt ends it at once.
  const arriving = useRef(true);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const done = (): void => {
      arriving.current = false;
      setArrived(true);
    };
    const arrive = (): void => {
      if (Math.abs(map.getZoom() - AROUND_ZOOM) < 0.01 && Math.abs(map.getPitch() - AROUND_PITCH) < 0.5) done();
    };
    const yours = (e: { originalEvent?: unknown }): void => {
      if (e.originalEvent) done();
    };
    map.on("moveend", arrive);
    map.on("zoomstart", yours);
    map.on("pitchstart", yours);
    return () => {
      map.off("moveend", arrive);
      map.off("zoomstart", yours);
      map.off("pitchstart", yours);
    };
  }, [map]);

  // You stay in the middle of the free area: when it changes size, and as you move while followed. Turning following
  // off moves nothing, so a flight to a pip runs its course. While following, the map is north up, or turned to
  // your heading once the compass knows it.
  const lat = here?.lat;
  const lon = here?.lon;
  // North up until the compass knows your heading, so a map waiting for compass permission is not left askew.
  const bearing = facing && heading !== null ? heading : 0;
  const latest = useRef({ following, lat, lon, bearing });
  latest.current = { following, lat, lon, bearing };
  const centre = useRef((f: Rect, motion: EaseToOptions): void => {
    const { following: on, lat: la, lon: lo, bearing: b } = latest.current;
    const canvas = map.getCanvas();
    const padding: PaddingOptions = { top: f.top, left: f.left, right: Math.max(0, canvas.clientWidth - f.right), bottom: Math.max(0, canvas.clientHeight - f.bottom) };
    if (!on || la === undefined || lo === undefined) {
      map.easeTo({ padding, duration: motion.duration });
      return;
    }
    const camera = { center: [lo, la] as [number, number], padding, ...(b !== null ? { bearing: b } : {}), essential: true };
    map.easeTo(arriving.current ? { ...camera, zoom: AROUND_ZOOM, pitch: AROUND_PITCH, duration: 1200 } : { ...camera, ...motion });
  });
  useEffect(() => {
    if (frame) centre.current(frame, { duration: 300 });
  }, [frame]);
  // Following again may cross the city, so it eases in and out; while it follows, each new fix is a small chase step.
  const wasFollowing = useRef(following);
  useEffect(() => {
    const resumed = following && !wasFollowing.current;
    wasFollowing.current = following;
    if (frame && following && lat !== undefined) centre.current(frame, resumed ? { duration: 700 } : STEP);
    // `frame` is handled above; here only you and the following switch move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, lat, lon]);
  // A new heading turns the map briefly; nothing runs while it holds still. The first flight keeps its course.
  useEffect(() => {
    if (frame && following && lat !== undefined && !arriving.current) centre.current(frame, TURN);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bearing]);
  return arrived;
}

/** A faint ring at the search radius, so the edge of "near" is visible. */
function useRadiusRing(map: MapLibreMap, here: Here | null, radiusM: number): void {
  const data = useMemo((): GeoJSON.FeatureCollection | null => {
    if (!here) return null;
    const ring = Array.from({ length: 97 }, (_, i) => {
      const p = destination(here, (i / 96) * 360, radiusM);
      return [p.lon, p.lat];
    });
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } }] };
  }, [here, radiusM]);
  useGeoJsonLayer(map, {
    id: "city-around-radius",
    data,
    belowLabels: true,
    layers: (source) => [{ id: `${source}-line`, type: "line", source, paint: { "line-color": MAP_INK.ice, "line-opacity": 0.32, "line-width": 1, "line-dasharray": [2, 4] } }],
  });
}

// ── Markers and edge pips ─────────────────────────────────────────

interface Mark {
  item: PlacedItem;
  x: number;
  y: number;
}

interface Layout {
  marks: Mark[];
  /** `key` stays with a pip through merges and splits; see `stablePipKeys`. */
  pips: (Pip & { lead: PlacedItem; count: number; key: string })[];
}

const EMPTY: Layout = { marks: [], pips: [] };

function layoutOf(map: MapLibreMap, frame: Rect, items: readonly PlacedItem[], here: Here | null, selected: string | null, keep: { keys: string[]; focused: string | null }): Layout {
  // A marker in the band where pips run would sit under them, so it becomes a pip beside where it stands.
  const shown = markArea(frame);
  // Pips point from you, or from the middle of the frame while you are off screen.
  const anchor = here ? map.project([here.lon, here.lat]) : { x: (frame.left + frame.right) / 2, y: (frame.top + frame.bottom) / 2 };
  const marks: Mark[] = [];
  const off: PipInput[] = [];
  const byKey = new Map<string, PlacedItem>();
  for (const item of items) {
    if (typeof item.at !== "object") continue;
    const p = map.project([item.at.lon, item.at.lat]);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    byKey.set(item.key, item);
    if (inside(p, shown)) marks.push({ item, x: p.x, y: p.y });
    else off.push({ key: item.key, target: p, distanceM: item.distanceM });
  }
  const laid = layoutPips(off, anchor, frame, pipSize, selected);
  const keys = stablePipKeys(laid, keep.keys, keep.focused);
  const pips = laid.flatMap((pip, i) => {
    const lead = byKey.get(pip.members[0] ?? "");
    return lead ? [{ ...pip, lead, count: pip.members.length, key: keys[i] ?? lead.key }] : [];
  });
  return { marks, pips };
}

/** A marker chip's radius: a touch this close to its edge, plus the tap radius, reaches it. */
const MARK_RADIUS_PX = 15;
/** How long a newly found item keeps its entrance, so panning it out of view and back does not replay it. */
const ARRIVAL_MS = 900;
const NONE: ReadonlySet<string> = new Set();

const NO_ITEMS: readonly PlacedItem[] = [];

/** Markers drawn by the source's own renderer (`nearbyMapLayers`), such as camera pictures. */
const SourceMarks = memo(function SourceMarks({ map, layers, bySource, selected }: { map: MapLibreMap; layers: Contributed<"nearbyMapLayers">[]; bySource: ReadonlyMap<string, readonly PlacedItem[]>; selected: string | null }): ReactElement {
  return (
    <>
      {layers.map(({ item: layer }) => {
        const View = lazyView(layer.view);
        return (
          <Boundary key={layer.source} name={layer.source} silent>
            <Suspense fallback={null}>
              <View map={map} items={bySource.get(layer.source) ?? NO_ITEMS} selected={selected} choose={(item) => chooseItem(map, item)} />
            </Suspense>
          </Boundary>
        );
      })}
    </>
  );
});

function Marks({ map, frame, items, here }: { map: MapLibreMap; frame: Rect | null; items: PlacedItem[]; here: Here | null }): ReactElement {
  const selected = useCity((s) => s.selected);
  const units = useSettings((s) => s.units);
  const layers = useMemo(() => contributions("nearbyMapLayers"), []);
  const customSources = useMemo(() => new Set(layers.map(({ item }) => item.source)), [layers]);
  const [layout, setLayout] = useState<Layout>(EMPTY);

  // Positions follow the camera, once per frame while it moves and not at all while it rests.
  const root = useRef<HTMLDivElement>(null);
  const inputs = useRef({ frame, items, here, selected });
  inputs.current = { frame, items, here, selected };
  useEffect(() => {
    let alive = true;
    let booked = false;
    const layoutNow = (): void => {
      booked = false;
      if (!alive) return;
      const { frame: f, items: list, here: h, selected: s } = inputs.current;
      const focused = root.current?.querySelector<HTMLElement>(".city-pip:focus")?.dataset.key ?? null;
      setLayout((prev) => (f ? layoutOf(map, f, list, h, s, { keys: prev.pips.map((p) => p.key), focused }) : EMPTY));
    };
    // `move` fires inside the frame the map draws. Laid out at the end of that frame and committed before the
    // browser paints, the chips move with the ground; a layout booked for the next frame would trail it by one.
    const update = (): void => {
      if (booked) return;
      booked = true;
      queueMicrotask(() => flushSync(layoutNow));
    };
    layoutNow();
    map.on("move", update);
    map.on("resize", update);
    return () => {
      alive = false;
      map.off("move", update);
      map.off("resize", update);
    };
  }, [map, frame, items, here, selected]);

  // Source renderers place their own marks, so they hear when the set of items in view changes, not on every frame.
  // They get the newest copy of each item: the layout may still hold the previous one for a render.
  const inViewKeys = layout.marks.flatMap(({ item }) => (customSources.has(item.source) ? [item.key] : [])).join("\n");
  const bySource = useMemo(() => {
    const inView = new Set(inViewKeys.split("\n"));
    const groups = new Map<string, PlacedItem[]>();
    for (const item of items) {
      if (!inView.has(item.key)) continue;
      const group = groups.get(item.source);
      if (group) group.push(item);
      else groups.set(item.source, [item]);
    }
    return groups;
  }, [inViewKeys, items]);

  // Only things that just arrived in the data animate in.
  const known = useRef(new Set<string>());
  const [arrivals, setArrivals] = useState<ReadonlySet<string>>(NONE);
  // One timer for the latest arrivals; a later list without newcomers must not cancel it.
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const fresh = new Set(items.filter((i) => !known.current.has(i.key)).map((i) => i.key));
    for (const i of items) known.current.add(i.key);
    if (fresh.size === 0) return;
    setArrivals(fresh);
    clearTimeout(settle.current);
    settle.current = setTimeout(() => setArrivals(NONE), ARRIVAL_MS);
  }, [items]);
  useEffect(() => () => clearTimeout(settle.current), []);

  // A touch near a marker chooses it, so a fingertip need not land on the 30 px chip.
  useTapTargets(map, (point, radius) =>
    radius === 0
      ? []
      : layout.marks.map((m) => ({ distance: Math.hypot(point.x - m.x, point.y - m.y), activate: () => chooseItem(map, m.item) })).filter((t) => t.distance <= radius + MARK_RADIUS_PX),
  );

  return (
    <div ref={root} className="city-around" role="group" aria-label="Nearby on the map">
      <SourceMarks map={map} layers={layers} bySource={bySource} selected={selected} />
      {layout.marks.filter(({ item }) => !customSources.has(item.source)).reverse().map(({ item, x, y }) => {
        const chosen = item.key === selected;
        return (
          <button
            key={item.key}
            type="button"
            className="city-mark"
            data-tone={item.tone}
            data-chosen={chosen || undefined}
            data-live={(item.live ?? item.urgency === "now") || undefined}
            data-fresh={arrivals.has(item.key) || undefined}
            style={{ transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)` }}
            aria-label={itemLabel(item, units)}
            title={item.title}
            onClick={() => chooseItem(map, item)}
          >
            <span className="city-mark__chip">
              <ItemIcon icon={item.icon} size={14} />
            </span>
            {chosen && <span className="city-mark__label">{item.title}</span>}
          </button>
        );
      })}
      {layout.pips.map((pip) => {
        const extra = pip.count - 1;
        return (
          <button
            key={`pip:${pip.key}`}
            data-key={pip.key}
            type="button"
            className="city-pip"
            data-side={pip.side}
            data-tone={pip.lead.tone}
            data-chosen={pip.lead.key === selected || undefined}
            data-fresh={arrivals.has(pip.lead.key) || undefined}
            style={{ transform: `translate(${pip.x.toFixed(1)}px, ${pip.y.toFixed(1)}px)` }}
            aria-label={`${itemLabel(pip.lead, units)}${extra > 0 ? `, and ${extra} more that way` : ""}. Show it on the map.`}
            onClick={() => focusItem(map, pip.lead)}
          >
            <span className="city-pip__glyphs" aria-hidden>
              <ChevronRight className="city-pip__arrow" size={12} strokeWidth={2.5} style={{ rotate: `${pip.angle.toFixed(0)}deg` }} />
              <ItemIcon icon={pip.lead.icon} size={13} />
            </span>
            <span className="city-pip__dist num">{fmt.distance(pip.lead.distanceM, units)}</span>
            {extra > 0 && <span className="city-pip__more num">+{extra}</span>}
          </button>
        );
      })}
    </div>
  );
}
