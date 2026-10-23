import { ChevronUp, History, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { sfx } from "../../app/core/sound";
import { Button, Empty, IconButton, Panel, Scanning, Segmented, Tag } from "../../app/ui";
import { useMapView, type MapControlProps } from "../city/extension";
import { useEras } from "./client";
import { dimBase, EraSheet, type Look } from "./era-sheet";
import { useTimeMachine, type CompareMode, type Tint } from "./store";
import { Swipe } from "./Swipe";
import { Timeline, type Stop } from "./Timeline";
import type { Era, EraKind } from "./types";
import "./timemachine.css";

const FADE_MS = 520;
const SPRING = { type: "spring", duration: 0.4, bounce: 0 } as const;

const KIND_LABEL: Record<EraKind, string> = { map: "Map", aerial: "Aerial photo", orbit: "From orbit" };

const COMPARE: readonly { value: CompareMode; label: string }[] = [
  { value: "fade", label: "Fade" },
  { value: "swipe", label: "Swipe" },
];
const TINTS: readonly { value: Tint; label: string }[] = [
  { value: "true", label: "True colour" },
  { value: "night", label: "Night tint" },
];

const TODAY: Stop = { id: null, year: new Date().getFullYear(), label: "Today", kind: "today" };

/**
 * The Time machine: a dial on the City map that lays an old map or aerial photo over the night map. "Around me" keeps
 * the map for what is near you, so there the closed pill shows only while an era is on the map; its list offers the
 * past through "This street in …".
 */
export default function Control({ map, mode: mapMode }: MapControlProps): ReactElement {
  const reduced = usePrefersReducedMotion();
  const view = useMapView(map);
  const { eras, unreachable, loading, settled, error, retry } = useEras(view.center);
  const { open, era: active, mode, tint, strength, split, seekOldest, notice, set, pick, setSplit, settle } = useTimeMachine();
  const eraId = active?.id ?? null;

  // An era stays on the map after you pan beyond its coverage; it joins the list so the card can still describe it.
  const outside = active !== null && !eras.some((e) => e.id === active.id);
  const shown = useMemo<Era[]>(() => (outside && active ? [...eras, active].sort((a, b) => a.year - b.year) : eras), [eras, active, outside]);
  const stops = useMemo<Stop[]>(() => [...shown.map((e) => ({ id: e.id, year: e.year, label: e.label, kind: e.kind })), TODAY], [shown]);
  const pickStop = (id: string | null): void => pick(id ? (shown.find((e) => e.id === id) ?? null) : null);

  const look = useMemo<Look>(() => ({ tint, strength }), [tint, strength]);

  // Fade mode lays the era on the City map itself, beneath the street names.
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  const sheet = useRef<EraSheet | null>(null);
  useEffect(() => {
    const s = new EraSheet(map, true, reducedRef.current ? 0 : FADE_MS);
    sheet.current = s;
    return () => {
      s.dispose();
      sheet.current = null;
    };
  }, [map]);
  useEffect(() => {
    sheet.current?.show(mode === "fade" ? active : null, look);
  }, [map, mode, active, look]);

  const fading = mode === "fade" && active !== null;
  useEffect(() => {
    if (!fading) return;
    dimBase(map, strength);
    return () => dimBase(map, 0);
  }, [map, fading, strength]);

  // "Show this place in the oldest map" waits here until the lookup for the map's centre has finished.
  useEffect(() => {
    if (!seekOldest || !settled) return;
    if (error) {
      settle(`The eras for this spot could not be looked up: ${error}`);
      return;
    }
    const oldest = eras.find((e) => e.kind !== "orbit") ?? eras[0];
    if (!oldest) {
      settle("No older map or photo is published for this spot.");
      return;
    }
    pick(oldest);
    settle(null);
    sfx.lock();
    // A 1712 map of the whole province is useless at street level: draw back to where it reads.
    if (map.getZoom() > oldest.viewZoom) map.easeTo({ zoom: oldest.viewZoom, duration: reducedRef.current ? 0 : 1400 });
  }, [map, seekOldest, settled, error, eras, pick, settle]);

  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chips.current?.querySelector("[data-active]")?.scrollIntoView({ inline: "center", block: "nearest", behavior: reducedRef.current ? "auto" : "smooth" });
  }, [eraId, open, stops.length]);

  const eraCount = eras.length;
  const needsZoom = active !== null && view.zoom < active.minzoom;
  const status = loading ? "Looking back…" : eraCount === 1 ? "1 era here" : `${eraCount} eras here`;

  return (
    <div className="timemachine">
      <AnimatePresence mode="popLayout" initial={false}>
        {open ? (
          <motion.div key="panel" className="timemachine-shell" initial={reduced ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: 10 }} transition={SPRING}>
            <Panel
              title={
                <>
                  Time machine <span className="timemachine-status num">{status}</span>
                </>
              }
              actions={
                <IconButton label="Close Time machine" onClick={() => set({ open: false })}>
                  <X size={14} />
                </IconButton>
              }
            >
              {error && eraCount === 0 ? (
                <Empty
                  title="Could not look up the past"
                  tone="error"
                  action={
                    <Button size="sm" onClick={retry}>
                      Try again
                    </Button>
                  }
                >
                  {error}
                </Empty>
              ) : !settled && eraCount === 0 ? (
                <Scanning label="Looking back" />
              ) : (
                <div className="timemachine-body">
                  <Timeline stops={stops} activeId={eraId} onPick={pickStop} />
                  <div ref={chips} className="timemachine-chips" role="group" aria-label="Eras here">
                    {stops.map((s) => (
                      <button key={s.id ?? "today"} type="button" className="timemachine-chip" data-active={s.id === eraId || undefined} aria-pressed={s.id === eraId} onClick={() => pickStop(s.id)}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                  <Card era={active} outside={outside} needsZoom={needsZoom} onlyOrbit={eraCount > 0 && eras.every((e) => e.kind === "orbit")} />
                  <div className="timemachine-controls" inert={!active}>
                    <Segmented label="Compare" value={mode} options={COMPARE} onChange={(m) => set({ mode: m })} />
                    <Segmented label="Colour" value={tint} options={TINTS} onChange={(t) => set({ tint: t })} />
                    <label className="timemachine-strength">
                      <span className="v-eyebrow">Strength</span>
                      <input type="range" min={10} max={100} step={5} value={Math.round(strength * 100)} onChange={(e) => set({ strength: Number(e.target.value) / 100 })} aria-label="How strongly the past shows" />
                      <span className="num timemachine-strength-value">{Math.round(strength * 100)}%</span>
                    </label>
                  </div>
                  {unreachable.length > 0 && <p className="timemachine-note">{unreachable.join(", ")} did not answer, so some eras may be missing here.</p>}
                  {notice && <p className="timemachine-note">{notice}</p>}
                </div>
              )}
            </Panel>
          </motion.div>
        ) : mapMode === "map" || active ? (
          <motion.button
            key="pill"
            type="button"
            className="v-panel timemachine-pill"
            data-era={active ? "" : undefined}
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: 10 }}
            transition={SPRING}
            onClick={() => {
              sfx.click();
              set({ open: true });
            }}
          >
            <History size={15} />
            <span className="v-eyebrow">Time machine</span>
            <span className="timemachine-status num">{active ? active.label : status}</span>
            <ChevronUp size={14} className="timemachine-pill__chev" />
          </motion.button>
        ) : null}
      </AnimatePresence>

      {active && (
        <p className="timemachine-credit num">
          {active.label} · {active.publisher} · {active.licence}
        </p>
      )}

      {active && mode === "swipe" && <Swipe map={map} era={active} look={look} split={split} onSplit={setSplit} thenLabel={active.label} nowLabel="Today" />}
    </div>
  );
}

function Card({ era, outside, needsZoom, onlyOrbit }: { era: Era | null; outside: boolean; needsZoom: boolean; onlyOrbit: boolean }): ReactElement {
  return (
    <div className="timemachine-card">
      <div className="timemachine-card__year display">{era ? era.yearLabel : "Today"}</div>
      <div className="timemachine-card__text">
        <div className="timemachine-card__name">
          {era ? era.name : "The night map"}
          {era && <Tag>{KIND_LABEL[era.kind]}</Tag>}
        </div>
        <p>{era ? era.context : "The map you started from. Drag along the ruler, or pick a year, to travel back."}</p>
        {outside && <p className="timemachine-card__aside">This era has nothing at the spot in the middle of the map. Pan back, or pick another.</p>}
        {needsZoom && era && <p className="timemachine-card__aside">The publisher shows this era only from zoom {era.minzoom}. Zoom in to see it.</p>}
        {!era && onlyOrbit && <p className="timemachine-card__aside">No older map or aerial photo is published for this place. Only views from orbit are listed.</p>}
      </div>
    </div>
  );
}
