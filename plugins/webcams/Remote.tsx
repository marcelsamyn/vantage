import { Moon, Sun, Sunset } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useState, type ReactElement } from "react";
import { useNow, usePoll } from "../../app/core/hooks";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, LiveDot, Scanning, Segmented, Toggle } from "../../app/ui";
import { fetchRemote } from "./client";
import { Focus } from "./Focus";
import { cameraItem, darkNote, KIND_LABEL, staggerSlot } from "./items";
import { localTime, sunInfo, type Daylight } from "./sky";
import { Tile } from "./Tile";
import type { CameraKind, Webcam } from "./types";

type Group = "all" | "volcano" | "polar" | "sky" | "ocean";

const GROUPS: readonly { value: Group; label: string }[] = [
  { value: "all", label: "All" },
  { value: "volcano", label: "Volcanoes" },
  { value: "polar", label: "Polar" },
  { value: "sky", label: "Sky" },
  { value: "ocean", label: "Ocean" },
];
const KIND_ORDER: readonly CameraKind[] = ["volcano", "polar", "sky", "observatory", "ocean", "traffic", "weather"];
const ORDER: Record<Daylight, number> = { day: 0, twilight: 1, night: 2 };
const PAGE = 12;

const inGroup = (c: Webcam, g: Group): boolean => g === "all" || (g === "sky" ? c.kind === "sky" || c.kind === "observatory" : c.kind === g);

const DaylightIcon = ({ state }: { state: Daylight }): ReactElement => (state === "day" ? <Sun size={11} /> : state === "twilight" ? <Sunset size={11} /> : <Moon size={11} />);

/** The Remote tab: public cameras in places few people go, with the local time and whether the Sun is up there. */
export function RemoteTab(): ReactElement {
  const units = useSettings((s) => s.units);
  const now = useNow(60_000);
  const remote = usePoll(fetchRemote, 300_000, []);
  const [group, setGroup] = useState<Group>("all");
  const [litOnly, setLitOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  // The open camera is remembered by key: the gallery re-sorts as day and night move around the Earth.
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const ranked = useMemo(() => {
    const lit = (remote.data?.cameras ?? [])
      .filter((c) => inGroup(c, group))
      .map((c) => ({ c, sun: sunInfo(c.lat, c.lon, now) }))
      .filter(({ sun }) => !litOnly || sun.state === "day");
    // Daylight first, and within each state one camera of every kind in turn, so the top of the gallery is varied.
    const seen = new Map<string, number>();
    return lit
      .map((x) => {
        const slot = `${x.sun.state}:${x.c.kind}`;
        const turn = seen.get(slot) ?? 0;
        seen.set(slot, turn + 1);
        return { ...x, turn };
      })
      .sort((a, b) => ORDER[a.sun.state] - ORDER[b.sun.state] || a.turn - b.turn || KIND_ORDER.indexOf(a.c.kind) - KIND_ORDER.indexOf(b.c.kind) || a.c.name.localeCompare(b.c.name));
  }, [remote.data, group, litOnly, now]);

  const visible = ranked.slice(0, shown);
  const items = useMemo(() => ranked.map(({ c }) => cameraItem(c, null, units, now)), [ranked, units, now]);
  const lit = ranked.filter(({ sun }) => sun.state === "day").length;
  const focusIndex = focusKey === null ? -1 : items.findIndex((item) => item.key === focusKey);

  // A camera that a filter removed cannot stay open.
  useEffect(() => {
    if (focusKey !== null && focusIndex < 0) setFocusKey(null);
  }, [focusKey, focusIndex]);

  if (remote.error && !remote.data) {
    return (
      <Empty title="The remote cameras could not load" tone="error" action={<Button onClick={remote.refresh}>Try again</Button>}>
        {remote.error.message}
      </Empty>
    );
  }
  if (!remote.data) return <Scanning label="Reaching the volcanoes, the ice and the open sea" />;

  return (
    <div className="webcams-remote">
      <div className="webcams-bar">
        <div>
          <div className="v-eyebrow v-eyebrow--sodium webcams-eyebrow">
            <LiveDot tone="sodium" /> Places nobody goes
          </div>
          <p className="webcams-bar__count num">
            {ranked.length} cameras · {lit} in daylight now{remote.data.failed.length ? ` · unavailable: ${remote.data.failed.join(", ")}` : ""}
          </p>
        </div>
        <div className="webcams-bar__controls">
          <Segmented
            label="Kind of place"
            value={group}
            onChange={(g) => {
              setGroup(g);
              setShown(PAGE);
            }}
            options={GROUPS}
          />
          <Toggle checked={litOnly} onChange={setLitOnly} label="Daylight only" />
        </div>
      </div>

      {ranked.length === 0 ? (
        <Empty title="Nothing is in daylight in this group">Turn off “Daylight only”, or pick another kind of place.</Empty>
      ) : (
        <div className="webcams-grid">
          {visible.map(({ c, sun }) => (
            <Tile key={c.id} tag={KIND_LABEL[c.kind].toUpperCase()} label={`${c.name}, ${c.providerName}`} src={c.image} refreshS={c.refreshS} frames={c.frames} alt={`View from ${c.name}`} index={staggerSlot(c.id, PAGE)} selected={focusKey === c.id} note={darkNote(c, now)} onOpen={() => setFocusKey(c.id)}>
              <span className="webcams-tile__name">{c.name}</span>
              <span className="webcams-tile__sub num">
                <span className="webcams-tile__sun" data-state={sun.state}>
                  <DaylightIcon state={sun.state} /> {c.tz ? localTime(c.tz, now) : ""}
                </span>{" "}
                · {c.providerName}
              </span>
            </Tile>
          ))}
        </div>
      )}
      {ranked.length > shown && (
        <div className="webcams-more">
          <Button onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, ranked.length - shown)} more</Button>
        </div>
      )}

      <AnimatePresence>{focusIndex >= 0 && <Focus key="focus" items={items} index={focusIndex} onIndex={(i) => setFocusKey(items[i]?.key ?? null)} onClose={() => setFocusKey(null)} />}</AnimatePresence>
    </div>
  );
}
