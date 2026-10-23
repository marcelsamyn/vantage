import { motion } from "motion/react";
import { useState, type ReactElement } from "react";
import type { PluginId } from "../../plugins";
import { useHotkey } from "../core/hooks";
import { useNav } from "../core/nav";
import { RAIL_SECTIONS, screens, type RailSection } from "../core/plugin";
import { sfx } from "../core/sound";
import { Glyph, mark } from "../ui";

/** Section names: read out in the rail, which shows sections only as a quiet rule, and shown in the phone More sheet. */
export const SECTION_LABEL: Record<RailSection, string> = { here: "Here", world: "World", signals: "Signals", yours: "Yours", tools: "Tools" };

export function Rail(): ReactElement {
  const active = useNav((s) => s.active);
  const go = useNav((s) => s.go);
  const all = screens();
  const sections = RAIL_SECTIONS.map((section) => ({ section, screens: all.filter(({ item }) => item.section === section) })).filter((s) => s.screens.length > 0);
  const [tip, setTip] = useState<{ title: string; summary: string; y: number } | null>(null);

  useHotkey(
    (e) => !e.metaKey && !e.ctrlKey && !e.altKey && all.some(({ item }) => item.hotkey === e.key),
    (e) => {
      const hit = all.find(({ item }) => item.hotkey === e.key);
      if (hit) go(hit.plugin.id as PluginId);
    },
  );

  return (
    <nav className="rail" aria-label="Screens">
      <div className="rail__mark" aria-hidden>
        <Glyph glyph={mark} size={20} />
      </div>
      {sections.map(({ section, screens: list }) => (
        <div key={section} className="rail__section" role="group" aria-label={SECTION_LABEL[section]}>
          {list.map(({ plugin, item }) => {
            const current = plugin.id === active;
            return (
              <button
                key={plugin.id}
                type="button"
                className="rail__btn"
                aria-current={current ? "page" : undefined}
                aria-label={item.title}
                onClick={() => go(plugin.id as PluginId)}
                onMouseEnter={(e) => {
                  sfx.hover();
                  const r = e.currentTarget.getBoundingClientRect();
                  setTip({ title: item.title, summary: item.summary, y: r.top + r.height / 2 });
                }}
                onMouseLeave={() => setTip(null)}
                onFocus={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setTip({ title: item.title, summary: item.summary, y: r.top + r.height / 2 });
                }}
                onBlur={() => setTip(null)}
              >
                {current && <motion.span layoutId="rail-indicator" className="rail__indicator" transition={{ type: "spring", duration: 0.35, bounce: 0 }} />}
                <Glyph glyph={item.glyph} />
                {item.hotkey && <span className="rail__key">{item.hotkey}</span>}
              </button>
            );
          })}
        </div>
      ))}
      <div className="rail__spacer" />
      {tip && (
        <motion.div
          className="rail__tip"
          style={{ top: tip.y, translateY: "-50%" }}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.14 }}
          role="tooltip"
        >
          <strong>{tip.title}</strong>
          <span>{tip.summary}</span>
        </motion.div>
      )}
    </nav>
  );
}
