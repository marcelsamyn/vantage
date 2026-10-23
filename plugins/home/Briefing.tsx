import { ArrowUpRight, Check, Eye, EyeOff, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion, type Variants } from "motion/react";
import { Suspense, useMemo, useState, type ReactElement } from "react";
import { useStoredState } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { go, useIntent } from "../../app/core/nav";
import { byOrder, contributions, lazyView } from "../../app/core/plugin";
import { TileSlotContext } from "../../app/core/tile";
import { Boundary, Button, Empty, IconButton, Page, Panel, Scanning } from "../../app/ui";
import type { PluginId } from "..";
import "./home.css";

// The grid staggers its tiles in once, when the Briefing opens. A tile shown again later appears at once.
const GRID: Variants = { enter: { transition: { delayChildren: 0.1, staggerChildren: 0.06 } } };
const TILE: Variants = { start: { opacity: 0, y: 12 }, enter: { opacity: 1, y: 0, transition: { type: "spring", duration: 0.5, bounce: 0 } } };

/** The home screen: a grid of live tiles contributed by every plugin, minus the ones the viewer hid. */
export default function Briefing(): ReactElement {
  const here = useLocation((st) => st.here);
  const locating = useLocation((st) => st.status === "locating");
  const tiles = useMemo(() => contributions("tiles").sort((a, b) => byOrder(a.item, b.item)), []);
  // Store what is hidden, not what is shown, so a tile from a new plugin appears until the viewer hides it.
  const [stored, setHidden] = useStoredState<unknown>("home:hidden-tiles", []);
  // Storage holds whatever an earlier version wrote; keep only ids of tiles that exist now, so stale ids drop out on the next save.
  const hidden = useMemo(() => {
    const known = new Set(tiles.map(({ item }) => item.id));
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
  }, [stored, tiles]);
  const [customizing, setCustomizing] = useState(false);
  // Tiles that said they have nothing to show (useTileEmpty). One stable callback per tile, so reports do not loop.
  const [empty, setEmpty] = useState<ReadonlySet<string>>(() => new Set());
  const reporters = useMemo(
    () =>
      new Map(
        tiles.map(({ item }) => [
          item.id,
          (isEmpty: boolean): void =>
            setEmpty((prev) => {
              if (prev.has(item.id) === isEmpty) return prev;
              const next = new Set(prev);
              if (isEmpty) next.add(item.id);
              else next.delete(item.id);
              return next;
            }),
        ]),
      ),
    [tiles],
  );
  useIntent("home", ({ action }) => {
    if (action === "customize") setCustomizing(true);
  });
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  const shown = tiles.filter(({ item }) => !hidden.includes(item.id));
  const tucked = tiles.filter(({ item }) => hidden.includes(item.id));
  const hide = (id: string): void => setHidden([...hidden, id]);
  const show = (id: string): void => setHidden(hidden.filter((x) => x !== id));

  return (
    <Page
      eyebrow={`Briefing · ${today}`}
      title={here ? (here.label ?? "Your surroundings") : locating ? "Locating you" : "Choose a place"}
      lede="What is happening around you right now."
      actions={
        <Button variant={customizing ? "primary" : "default"} icon={customizing ? <Check size={14} /> : <SlidersHorizontal size={14} />} onClick={() => setCustomizing(!customizing)}>
          {customizing ? "Done" : "Customize"}
        </Button>
      }
    >
      <AnimatePresence initial={false}>
        {customizing && (
          <motion.div key="tray" className="home-tray" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ type: "spring", duration: 0.35, bounce: 0 }}>
            <Panel
              title={`Hidden tiles · ${tucked.length}`}
              actions={
                tucked.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setHidden([])}>
                    Show all
                  </Button>
                )
              }
            >
              {tucked.length === 0 ? (
                <p className="home-tray__empty">Nothing is hidden. Hide a tile with its eye button and it waits here until you show it again.</p>
              ) : (
                <div className="home-tray__list">
                  {tucked.map(({ item }) => (
                    <Button key={item.id} size="sm" icon={<Eye size={13} />} aria-label={`Show ${item.title}`} title={`Show ${item.title} on the Briefing`} onClick={() => show(item.id)}>
                      {item.title}
                    </Button>
                  ))}
                </div>
              )}
            </Panel>
          </motion.div>
        )}
      </AnimatePresence>

      {shown.length === 0 && !customizing && (
        <Empty title="Every tile is hidden" action={<Button onClick={() => setCustomizing(true)}>Choose tiles to show</Button>}>
          The Briefing shows only the tiles you keep.
        </Empty>
      )}

      <motion.div className="home-grid" variants={GRID} initial="start" animate="enter">
        <AnimatePresence>
          {shown.map(({ plugin, item }) => {
            const View = lazyView(item.view);
            const screen = plugin.contributes.screen;
            return (
              <motion.div key={item.id} className={item.span === 2 ? "home-wide" : undefined} hidden={!customizing && empty.has(item.id)} variants={TILE} layout="position" exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}>
                <Panel
                  className="home-tile"
                  title={item.title}
                  active={customizing}
                  actions={
                    customizing ? (
                      <IconButton label={`Hide ${item.title}`} onClick={() => hide(item.id)}>
                        <EyeOff size={15} />
                      </IconButton>
                    ) : screen && plugin.id !== "home" ? (
                      <IconButton label={`Open ${screen.title}`} onClick={() => go(plugin.id as PluginId)}>
                        <ArrowUpRight size={15} />
                      </IconButton>
                    ) : undefined
                  }
                >
                  <Boundary name={item.title}>
                    <Suspense fallback={<Scanning label="Loading" />}>
                      <TileSlotContext.Provider value={reporters.get(item.id) ?? null}>
                        <View />
                      </TileSlotContext.Provider>
                    </Suspense>
                  </Boundary>
                </Panel>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>
    </Page>
  );
}
