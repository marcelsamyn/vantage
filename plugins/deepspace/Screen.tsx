import { motion } from "motion/react";
import { useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useStoredState } from "../../app/core/hooks";
import { useIntent } from "../../app/core/nav";
import { useSettings } from "../../app/core/settings";
import { Empty, LiveDot, Page, Scanning, Segmented, Stat } from "../../app/ui";
import { Dishes } from "./Dishes";
import { OrreryView } from "./Orrery";
import { openSpacecraft, useDsn, useSystem } from "./client";
import { farthestLink } from "./links";
import { distanceParts, lightTimeWords } from "./physics";
import type { DsnSnapshot, SpacecraftRef, SystemSnapshot } from "./types";
import "./deepspace.css";

type View = "dishes" | "orrery";

const VIEWS = [
  { value: "dishes", label: "Dishes" },
  { value: "orrery", label: "Solar System" },
] as const satisfies readonly { value: View; label: string }[];

/** The voice that reaches farthest, with the numbers that make the distance feel real. */
function Headline({ dsn }: { dsn: DsnSnapshot }): ReactElement {
  const units = useSettings((s) => s.units);
  const link = farthestLink(dsn.links);
  const dishes = dsn.complexes.flatMap((c) => c.dishes);
  const onAir = dishes.filter((d) => d.onAir).length;
  const craft = new Set(dsn.links.map((l) => l.spacecraft.naifId)).size;
  const rate = dsn.links.flatMap((l) => l.downlinks).reduce((sum, s) => sum + (s.rateBps ?? 0), 0);
  const distance = link?.distanceKm != null ? distanceParts(link.distanceKm, units) : null;
  const complexName = link ? (dsn.complexes.find((c) => c.id === link.complexId)?.name ?? "") : "";

  return (
    <motion.section className="deepspace-headline" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.5, bounce: 0 }}>
      <div className="deepspace-headline__lead">
        <div className="v-eyebrow v-eyebrow--sodium">
          <LiveDot tone="sodium" /> The farthest voice right now
        </div>
        {link ? (
          <>
            <button type="button" className="deepspace-headline__name display" onClick={() => openSpacecraft(link.spacecraft)}>
              {link.spacecraft.name}
            </button>
            <p className="deepspace-headline__sub">
              {complexName} is {link.uplinks.length > 0 ? "talking to it" : "listening to it"} through {link.dishIds.map((d) => d.replace(/^([A-Za-z]+)(\d+)$/, "$1 $2")).join(" and ")}.
            </p>
          </>
        ) : (
          <p className="deepspace-headline__sub">No spacecraft with a known distance is on air at this moment.</p>
        )}
      </div>
      <div className="deepspace-headline__stats">
        {distance && <Stat label="Distance from Earth" value={distance.value} unit={distance.unit} tone="sodium" />}
        {link?.lightSeconds != null && <Stat label="Signal left" value={lightTimeWords(link.lightSeconds)} unit="ago" />}
        <Stat label="On air" value={String(craft)} unit="spacecraft" hint={`${onAir} of ${dishes.length} dishes · ${rate > 0 ? fmt.bitsPerSecond(rate) : "no data"} down`} />
      </div>
    </motion.section>
  );
}

function matchCraft(name: string, dsn: DsnSnapshot | undefined, system: SystemSnapshot | undefined): SpacecraftRef | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const known: SpacecraftRef[] = [...(dsn?.links.map((l) => l.spacecraft) ?? []), ...(system?.bodies.filter((b) => b.kind === "probe").map((b) => ({ naifId: b.id, name: b.name })) ?? [])];
  return known.find((c) => c.name.toLowerCase() === needle) ?? known.find((c) => c.name.toLowerCase().includes(needle)) ?? null;
}

export default function DeepspaceScreen(): ReactElement {
  const dsn = useDsn();
  const system = useSystem();
  const [view, setView] = useStoredState<View>("deepspace:view", "dishes");
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ dsn: dsn.data, system: system.data });
  latest.current = { dsn: dsn.data, system: system.data };

  useIntent("deepspace", ({ action, arg }) => {
    setNotice(null);
    if (action === "dishes" || action === "orrery") setView(action);
    if (action === "spacecraft" && arg) {
      const found = matchCraft(arg, latest.current.dsn, latest.current.system);
      if (found) {
        setView("orrery");
        openSpacecraft(found);
      } else setNotice(`No spacecraft called "${arg}" is on the network or in the tracked list yet. Try "Voyager 1", "Juno" or "New Horizons".`);
    }
  });

  return (
    <Page
      eyebrow="Deep space"
      title="Deep space"
      lede="Three radio observatories, in Spain, California and Australia, take turns hearing every spacecraft that has left Earth's neighbourhood. This is who they are talking to right now."
      actions={<Segmented<View> label="View" value={view} options={VIEWS} onChange={setView} />}
    >
      <div className="deepspace">
        {notice && <p className="deepspace-fine deepspace-notice">{notice}</p>}
        {dsn.data && <Headline dsn={dsn.data} />}
        {view === "dishes" ? (
          dsn.data ? (
            <Dishes dsn={dsn.data} />
          ) : dsn.error ? (
            <Empty title="No reading from the Deep Space Network" tone="error">
              {dsn.error.message} The screen retries by itself every few seconds.
            </Empty>
          ) : (
            <Scanning label="Listening to the Deep Space Network" />
          )
        ) : (
          <OrreryView system={system.data} systemError={system.error} dsn={dsn.data} />
        )}
        <p className="deepspace-fine">
          Dish pointing, signals and ranges: NASA/JPL Deep Space Network Now, refreshed every few seconds. Positions: NASA/JPL Horizons. Received power is as the network reports it, rounded. Distances use Horizons when it knows the
          spacecraft and the network's own range otherwise.
        </p>
      </div>
    </Page>
  );
}
