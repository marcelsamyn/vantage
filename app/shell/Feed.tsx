import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { useState, type ReactElement } from "react";
import { useFeed, type FeedEvent } from "../core/feed";
import { fmt } from "../core/format";
import { useHotkey } from "../core/hooks";
import { go } from "../core/nav";
import { pluginById } from "../core/plugin";
import { profile } from "../core/profile";
import { Empty, IconButton, LiveDot, PHONE, useMediaQuery, type Tone } from "../ui";

const TONE: Record<FeedEvent["level"], Tone | undefined> = { info: undefined, live: "sodium", alert: "alarm", good: "mint" };

function act(event: FeedEvent): void {
  if (event.go) go(event.go.screen, { action: event.go.action, arg: event.go.arg });
  if (event.entity) profile.open(event.entity);
}

/** The bottom ticker: the newest events, sliding in from the left. Click the label for the full log. */
export function Ticker(): ReactElement {
  const events = useFeed((s) => s.events);
  const unread = useFeed((s) => s.unread);
  const [open, setOpen] = useState(false);

  useHotkey(
    (e) => e.key === "Escape" && open,
    () => setOpen(false),
    [open],
  );

  return (
    <>
      <footer className="ticker">
        <button
          type="button"
          className="ticker__label"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            useFeed.getState().markRead();
          }}
        >
          FEED
          {unread > 0 && <span className="ticker__count">{unread > 99 ? "99+" : unread}</span>}
        </button>
        <div className="ticker__rail">
          {events.length === 0 && <span className="ticker__empty">Listening to the city — events appear here as they happen.</span>}
          <AnimatePresence initial={false}>
            {events.slice(0, 8).map((e) => (
              <motion.button
                layout
                key={e.id}
                type="button"
                className="ticker__event"
                onClick={() => act(e)}
                initial={{ opacity: 0, x: -24, filter: "blur(4px)" }}
                animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0 }}
                transition={{ type: "spring", duration: 0.45, bounce: 0 }}
              >
                <span className={`lvl-${e.level}`}>
                  <LiveDot tone={TONE[e.level]} live={false} />
                </span>
                <span className="ticker__time">{fmt.clock(e.at)}</span>
                <span>{e.title}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </footer>
      <AnimatePresence>{open && <Drawer onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }): ReactElement {
  const events = useFeed((s) => s.events);
  return (
    <motion.section
      className="drawer"
      aria-label="Feed log"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
      transition={{ type: "spring", duration: 0.4, bounce: 0 }}
    >
      <header className="v-panel__head">
        <h2 className="v-eyebrow">Feed log · {events.length} events this session</h2>
        <IconButton label="Close feed log" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="drawer__list">
        {events.length === 0 && <Empty title="Nothing yet">Watchers post here when something happens: aircraft overhead, satellites rising, quakes, devices joining your Wi-Fi.</Empty>}
        {events.map((e) => (
          <button key={e.id} type="button" className="drawer__row" onClick={() => act(e)}>
            <span className="ticker__time">{fmt.clock(e.at, true)}</span>
            <span className={`lvl-${e.level}`}>
              <LiveDot tone={TONE[e.level]} live={false} />
            </span>
            <span className="drawer__source">{pluginById(e.source)?.name ?? "VANTAGE"}</span>
            <span>
              {e.title}
              {e.detail && <span className="drawer__detail">{e.detail}</span>}
            </span>
          </button>
        ))}
      </div>
    </motion.section>
  );
}

export function Toasts(): ReactElement {
  const toasts = useFeed((s) => s.toasts);
  const dismiss = useFeed((s) => s.dismissToast);
  // Phones show toasts just above the ticker, so they rise from below; elsewhere they drop from under the bar.
  const from = useMediaQuery(PHONE) ? 12 : -12;
  return (
    <div className="toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            layout
            key={t.id}
            type="button"
            className={`toast lvl-${t.level}`}
            onClick={() => {
              act(t);
              dismiss(t.id);
            }}
            initial={{ opacity: 0, y: from, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: from / 2, transition: { duration: 0.16 } }}
            transition={{ type: "spring", duration: 0.4, bounce: 0 }}
          >
            <span className="toast__band" />
            <span className="toast__body">
              <span className="v-eyebrow" style={{ color: "inherit" }}>
                {pluginById(t.source)?.name ?? "VANTAGE"}
              </span>
              <span className="toast__title" style={{ display: "block" }}>
                {t.title}
              </span>
              {t.detail && <span className="toast__detail">{t.detail}</span>}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
