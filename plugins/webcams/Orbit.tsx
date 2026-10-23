import { AnimatePresence } from "motion/react";
import { useMemo, useState, type ReactElement } from "react";
import { useNow, usePoll } from "../../app/core/hooks";
import { Button, Empty, LiveDot, Scanning } from "../../app/ui";
import { fetchOrbit } from "./client";
import { Focus } from "./Focus";
import { orbitItem } from "./items";
import { Tile } from "./Tile";
import type { OrbitFrame } from "./types";

const SECTIONS: readonly { subject: OrbitFrame["subject"]; title: string }[] = [
  { subject: "earth", title: "Looking at Earth" },
  { subject: "sun", title: "Looking at the Sun" },
];

/** The Orbit tab: the newest picture from each spacecraft, with where it is and when it was taken. */
export function OrbitTab(): ReactElement {
  const now = useNow(30_000);
  const orbit = usePoll(fetchOrbit, 300_000, []);
  const [focus, setFocus] = useState<number | null>(null);
  const frames = useMemo(() => SECTIONS.flatMap((s) => (orbit.data?.frames ?? []).filter((f) => f.subject === s.subject)), [orbit.data]);
  const items = useMemo(() => frames.map((f) => orbitItem(f, now)), [frames, now]);

  if (orbit.error && !orbit.data) {
    return (
      <Empty title="The space cameras could not load" tone="error" action={<Button onClick={orbit.refresh}>Try again</Button>}>
        {orbit.error.message}
      </Empty>
    );
  }
  if (!orbit.data) return <Scanning label="Listening to the spacecraft" />;

  return (
    <div className="webcams-orbit">
      <div className="webcams-bar">
        <div>
          <div className="v-eyebrow v-eyebrow--sodium webcams-eyebrow">
            <LiveDot tone="sodium" /> From space
          </div>
          <p className="webcams-bar__count num">
            {frames.length} spacecraft pictures{orbit.data.failed.length ? ` · unavailable: ${orbit.data.failed.join(", ")}` : ""}
          </p>
        </div>
      </div>
      {SECTIONS.map(({ subject, title }) => {
        const group = frames.filter((f) => f.subject === subject);
        if (group.length === 0) return null;
        return (
          <section key={subject} className="webcams-section">
            <h2 className="v-eyebrow webcams-section__title">{title}</h2>
            <div className="webcams-grid webcams-grid--square">
              {group.map((f) => (
                <Tile key={f.id} tag={f.craft.split(" (")[0]?.toUpperCase() ?? f.craft} label={`${f.title}, ${f.craft}`} src={f.image} refreshS={f.refreshS} alt={`${f.title} from ${f.craft}`} index={frames.indexOf(f)} square capturedAt={f.capturedAt} selected={focus === frames.indexOf(f)} onOpen={() => setFocus(frames.indexOf(f))}>
                  <span className="webcams-tile__name">{f.title}</span>
                  <span className="webcams-tile__sub num">{f.vantage}</span>
                </Tile>
              ))}
            </div>
          </section>
        );
      })}
      <AnimatePresence>{focus !== null && items.length > 0 && <Focus key="focus" items={items} index={Math.min(focus, items.length - 1)} onIndex={setFocus} onClose={() => setFocus(null)} />}</AnimatePresence>
    </div>
  );
}
