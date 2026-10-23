import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid } from "lucide-react";
import { useState, type ReactElement } from "react";
import type { PluginId } from "../../plugins";
import { useHotkey, usePrefersReducedMotion } from "../core/hooks";
import { useNav } from "../core/nav";
import { RAIL_SECTIONS, screens } from "../core/plugin";
import { sfx } from "../core/sound";
import { Glyph, PHONE, Sheet, useMediaQuery } from "../ui";
import { SECTION_LABEL } from "./Rail";
import { TABS } from "./tabs";

/** The phone navigation: a bottom tab bar, and a More sheet that lists every screen by rail section. */
export function TabBar(): ReactElement {
  const active = useNav((s) => s.active);
  const go = useNav((s) => s.go);
  const [moreOpen, setMore] = useState(false);
  // The tab bar exists only on phones; a window that grows past the breakpoint leaves no sheet behind.
  const phone = useMediaQuery(PHONE);
  const more = moreOpen && phone;
  const all = screens();
  const tabs = TABS.flatMap((id) => all.filter(({ plugin }) => plugin.id === id));
  const inMore = !tabs.some(({ plugin }) => plugin.id === active);

  useHotkey(
    (e) => e.key === "Escape" && more,
    () => setMore(false),
    [more],
  );

  const open = (id: PluginId): void => {
    setMore(false);
    if (id !== active) go(id);
  };

  return (
    <>
      <nav className="tabs" aria-label="Screens">
        {tabs.map(({ plugin, item }) => {
          const current = plugin.id === active && !more;
          return (
            <button key={plugin.id} type="button" className="tabs__btn" aria-current={current ? "page" : undefined} onClick={() => open(plugin.id as PluginId)}>
              {current && <TabIndicator />}
              <Glyph glyph={item.glyph} size={22} />
              <span className="tabs__label">{item.title}</span>
            </button>
          );
        })}
        <button
          type="button"
          className="tabs__btn"
          aria-haspopup="dialog"
          aria-expanded={more}
          aria-current={inMore && !more ? "page" : undefined}
          data-open={more || undefined}
          onClick={() => {
            sfx.click();
            setMore(!more);
          }}
        >
          {(more || inMore) && <TabIndicator />}
          <LayoutGrid size={20} strokeWidth={1.5} />
          <span className="tabs__label">More</span>
        </button>
      </nav>
      <AnimatePresence>
        {more && (
          <Sheet key="more" label="All screens" className="more-sheet" onClose={() => setMore(false)} head={<span className="v-eyebrow v-eyebrow--ice more-sheet__title">All screens</span>}>
            <MoreList active={active} onOpen={open} />
          </Sheet>
        )}
      </AnimatePresence>
    </>
  );
}

function TabIndicator(): ReactElement {
  const reduced = usePrefersReducedMotion();
  return <motion.span layoutId="tab-indicator" className="tabs__indicator" transition={reduced ? { duration: 0 } : { type: "spring", duration: 0.35, bounce: 0 }} />;
}

function MoreList({ active, onOpen }: { active: PluginId; onOpen: (id: PluginId) => void }): ReactElement {
  const all = screens();
  return (
    <div className="more-sheet__sections">
      {RAIL_SECTIONS.map((section) => {
        const list = all.filter(({ item }) => item.section === section);
        if (list.length === 0) return null;
        return (
          <section key={section} className="more-sheet__section" aria-label={SECTION_LABEL[section]}>
            <h2 className="v-eyebrow">{SECTION_LABEL[section]}</h2>
            <div className="more-sheet__grid">
              {list.map(({ plugin, item }) => (
                <button
                  key={plugin.id}
                  type="button"
                  className="more-sheet__item"
                  aria-current={plugin.id === active ? "page" : undefined}
                  onClick={() => onOpen(plugin.id as PluginId)}
                >
                  <Glyph glyph={item.glyph} size={20} />
                  <span>{item.title}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
