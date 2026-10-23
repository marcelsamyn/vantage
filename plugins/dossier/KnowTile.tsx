import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useInterval, usePoll, usePrefersReducedMotion, useScreenActive } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { Empty, Scanning } from "../../app/ui";
import { fetchFacts } from "./client";
import "./dossier.css";

const ROTATE_MS = 30_000;

/** "{m:120}" becomes "120 m", or "394 ft" for users who chose imperial units. */
const withUnits = (text: string, units: "metric" | "imperial"): string => text.replace(/\{m:(\d+)\}/g, (_, metres: string) => fmt.distance(Number(metres), units));

/** One surprising public fact about where you are, changing every 30 seconds. */
export default function KnowTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const units = useSettings((s) => s.units);
  const active = useScreenActive();
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);

  const at = here ? { lat: Math.round(here.lat * 2000) / 2000, lon: Math.round(here.lon * 2000) / 2000 } : null;
  const { data, error, loading } = usePoll((signal) => (at ? fetchFacts(at, signal) : Promise.reject(new Error("no location"))), 15 * 60_000, [at?.lat, at?.lon], at === null);
  const facts = data?.facts ?? [];

  useEffect(() => setIndex(0), [at?.lat, at?.lon]);
  useInterval(() => setIndex((i) => i + 1), active && facts.length > 1 ? ROTATE_MS : null);

  if (!at) return status === "locating" ? <Scanning label="Locating" /> : <Empty title="Location unknown">Allow location or pin a place from the command palette, and this tile will look it up in the public registers.</Empty>;
  if (error && !data) return <Empty title="The registers did not answer" tone="error">{error.message}. This tile tries again in a few minutes.</Empty>;
  if (loading && !data) return <Scanning label="Searching the registers" />;
  if (facts.length === 0) {
    return (
      <Empty title="Nothing on file for this spot">
        VANTAGE reads heritage, tree, energy, parking and Wi-Fi registers for Rome, Brussels, Flanders, Ghent, Paris and Bologna. Pin a place there to see what they say.
      </Empty>
    );
  }

  const fact = facts[index % facts.length];
  if (!fact) return <Scanning label="Searching the registers" />;
  return (
    <div className="dossier-know">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={fact.id}
          className="dossier-know__fact"
          initial={reduced ? false : { opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={reduced ? undefined : { opacity: 0, y: -4, filter: "blur(3px)", transition: { duration: 0.16 } }}
          transition={{ type: "spring", duration: 0.45, bounce: 0 }}
        >
          <div className="v-eyebrow v-eyebrow--sodium">{fact.topic}</div>
          <p className="dossier-know__text">{withUnits(fact.text, units)}</p>
          <div className="dossier-know__source">{fact.source}</div>
        </motion.div>
      </AnimatePresence>
      {facts.length > 1 && (
        <div className="dossier-know__dots" aria-hidden>
          {facts.map((f, i) => (
            <span key={f.id} className={i === index % facts.length ? "dossier-know__dot dossier-know__dot--on" : "dossier-know__dot"} />
          ))}
        </div>
      )}
    </div>
  );
}
