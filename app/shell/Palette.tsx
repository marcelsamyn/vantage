import { AnimatePresence, motion } from "motion/react";
import { CornerDownLeft, Terminal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PluginId } from "../../plugins";
import type { Place } from "../../shared/location";
import { api, errorMessage, qs } from "../core/api";
import { enableDesktopNotifications, feed } from "../core/feed";
import { useHotkey } from "../core/hooks";
import { clearManualLocation, useLocation } from "../core/location";
import { go } from "../core/nav";
import { usePalette } from "../core/palette";
import { contributions, screens } from "../core/plugin";
import { useSettings } from "../core/settings";
import { sfx } from "../core/sound";
import { Glyph, Kbd } from "../ui";

interface Entry {
  /** Single-key shortcut shown next to the entry. */
  key?: string;
  id: string;
  title: string;
  hint?: string;
  keywords?: string[];
  arg?: { placeholder: string };
  run: (arg: string | undefined) => void;
  glyph: Glyph | null;
  group: string;
}

/** Commands the kernel itself offers. Plugins add theirs through the `commands` contribution. */
const KERNEL_COMMANDS: (Omit<Entry, "glyph" | "group">)[] = [
  {
    id: "kernel.sound",
    title: "Toggle interface sounds",
    keywords: ["mute", "audio", "volume"],
    run: () => useSettings.getState().set({ sound: !useSettings.getState().sound }),
  },
  {
    id: "kernel.units",
    title: "Switch metric / imperial units",
    keywords: ["miles", "km", "feet", "fahrenheit", "celsius"],
    run: () => useSettings.getState().set({ units: useSettings.getState().units === "metric" ? "imperial" : "metric" }),
  },
  {
    id: "kernel.notifications",
    title: "Enable desktop notifications",
    hint: "Alerts reach you while VANTAGE is in the background",
    keywords: ["notify", "alerts", "background"],
    run: () => {
      void enableDesktopNotifications().then((answer) =>
        feed(
          answer === "granted"
            ? { level: "good", source: "core", title: "Desktop notifications on", detail: "Toasts also appear as notifications while VANTAGE is in the background." }
            : { level: "alert", source: "core", title: "Notifications blocked", detail: "Allow notifications for this site in your browser settings, then try again." },
          { toast: true },
        ),
      );
    },
  },
  {
    id: "kernel.locate",
    title: "Locate me again",
    keywords: ["gps", "position", "where"],
    run: () => clearManualLocation(),
  },
  {
    id: "kernel.setLocation",
    title: "Set my location to…",
    hint: "Any city, address or landmark",
    keywords: ["move", "teleport", "pin", "place"],
    arg: { placeholder: "e.g. Chicago, IL" },
    run: (arg) => {
      if (!arg) return;
      void api<Place[]>(qs("/api/core/geocode", { q: arg }))
        .then((places) => {
          const p = places[0];
          if (!p) throw new Error(`No place called "${arg}"`);
          useLocation.getState().setManual(p.lat, p.lon, p.name === p.area ? p.name : `${p.name}, ${p.area.split(", ").pop() ?? ""}`);
          feed({ level: "good", source: "core", title: `Location pinned to ${p.name}`, detail: "Run “Locate me again” to return to your real position." }, { toast: true });
        })
        .catch((err: unknown) => feed({ level: "alert", source: "core", title: "Could not set location", detail: errorMessage(err) }, { toast: true }));
    },
  },
];

function entries(): Entry[] {
  const opens: Entry[] = screens().map(({ plugin, item }) => ({
    key: item.hotkey,
    id: `open.${plugin.id}`,
    title: `Open ${item.title}`,
    hint: item.summary,
    keywords: [plugin.id, plugin.name],
    glyph: item.glyph,
    group: "Screens",
    run: () => go(plugin.id as PluginId),
  }));
  const plugged: Entry[] = contributions("commands").map(({ plugin, item }) => {
    const { intent } = item;
    return {
      id: item.id,
      title: item.title,
      hint: item.hint,
      keywords: item.keywords,
      arg: item.arg,
      run: intent ? (arg) => go(plugin.id as PluginId, { action: intent.action, arg }) : item.run,
      glyph: plugin.contributes.screen?.glyph ?? null,
      group: plugin.name,
    };
  });
  const kernel: Entry[] = KERNEL_COMMANDS.map((c) => ({ ...c, glyph: null, group: "VANTAGE" }));
  return [...opens, ...plugged, ...kernel];
}

/** Subsequence match with a bonus for word starts. Returns -1 for no match. */
function score(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.includes(q)) return 100 - t.indexOf(q);
  let s = 0;
  let ti = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at < 0) return -1;
    s += at === 0 || t[at - 1] === " " ? 6 : 1;
    ti = at + 1;
  }
  return s;
}

export function Palette(): ReactElement {
  const open = usePalette((s) => s.open);
  const setOpen = usePalette((s) => s.setOpen);

  useHotkey(
    (e) => ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") || (e.key === "/" && !open),
    (e) => {
      e.preventDefault();
      setOpen(!open);
    },
    [open],
  );
  useHotkey(
    (e) => e.key.toLowerCase() === "m" && !e.metaKey && !e.ctrlKey,
    () => useSettings.getState().set({ sound: !useSettings.getState().sound }),
  );

  return <AnimatePresence>{open && <PaletteDialog onClose={() => setOpen(false)} />}</AnimatePresence>;
}

function PaletteDialog({ onClose }: { onClose: () => void }): ReactElement {
  const all = useMemo(entries, []);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<Entry | null>(null);
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), [pending]);

  const results = useMemo(() => {
    if (pending) return [];
    return all
      .map((e) => ({ e, s: Math.max(score(query, e.title), ...(e.keywords ?? []).map((k) => score(query, k) - 2), score(query, e.group) - 10) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((r) => r.e);
  }, [all, query, pending]);

  useEffect(() => setCursor(0), [query]);

  const run = (entry: Entry, arg?: string): void => {
    if (entry.arg && arg === undefined) {
      setPending(entry);
      setQuery("");
      return;
    }
    sfx.click();
    onClose();
    entry.run(arg);
  };

  return (
    <motion.div className="palette-scrim" onMouseDown={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
      <motion.div
        className="palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }}
        transition={{ type: "spring", duration: 0.32, bounce: 0 }}
      >
        <div className="palette__input">
          <Terminal size={16} className="ice" />
          {pending && <span className="palette__arg">{pending.title.replace(/…$/, "")}</span>}
          <input
            ref={inputRef}
            value={query}
            placeholder={pending?.arg?.placeholder ?? "Type a command or screen…"}
            spellCheck={false}
            aria-label="Command"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                if (pending) setPending(null);
                else onClose();
              } else if (e.key === "Backspace" && pending && query === "") {
                setPending(null);
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                setCursor((c) => Math.min(results.length - 1, c + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === "Enter") {
                if (pending) {
                  if (query.trim()) run(pending, query.trim());
                } else {
                  const hit = results[cursor];
                  if (hit) run(hit);
                }
              }
            }}
          />
          {/* Touch screens have no Escape key. */}
          <button type="button" className="palette__cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
        {!pending && (
          <div className="palette__list" role="listbox">
            {results.length === 0 && <div className="palette__item">No command matches “{query}”.</div>}
            {results.map((r, i) => (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={i === cursor}
                className="palette__item"
                onMouseMove={() => setCursor(i)}
                onClick={() => run(r)}
                ref={(el) => {
                  if (i === cursor) el?.scrollIntoView({ block: "nearest" });
                }}
              >
                <span className="palette__glyph">{r.glyph ? <Glyph glyph={r.glyph} size={18} /> : <Terminal size={16} />}</span>
                <span className="palette__title">
                  {r.title}
                  {r.hint && <span className="palette__hint" style={{ display: "block" }}>{r.hint}</span>}
                </span>
                {r.key ? <Kbd>{r.key.toUpperCase()}</Kbd> : <span className="palette__hint">{r.group}</span>}
              </button>
            ))}
          </div>
        )}
        <div className="palette__foot">
          <span>
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> move
          </span>
          <span>
            <Kbd>
              <CornerDownLeft size={10} />
            </Kbd>
            {pending ? "run" : "choose"}
          </span>
          <span>
            <Kbd>esc</Kbd> {pending ? "back" : "close"}
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}
