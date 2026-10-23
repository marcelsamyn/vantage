import { MAP_INK } from "../city/extension";
import type { MatrixDisplay, MatrixGantry } from "./types";

/** What a gantry looks like on the map: a short mark and a ring colour that says how serious it is. */
export interface GantryLook {
  label: string;
  ink: string;
  css: string;
}

const ALARM = { ink: MAP_INK.alarm, css: "var(--alarm)" };
const SODIUM = { ink: MAP_INK.sodium, css: "var(--sodium)" };
const MINT = { ink: MAP_INK.mint, css: "var(--mint)" };
const FOG = { ink: MAP_INK.fog, css: "var(--fog)" };

/** One lane's sign in a short form, for the map and the lane list. */
export function displayLook(d: MatrixDisplay): GantryLook {
  switch (d.kind) {
    case "speed":
      return { label: String(d.value), ...(d.enforced ? ALARM : SODIUM) };
    case "closed":
      return { label: "X", ...ALARM };
    case "ahead":
      return { label: d.direction === "left" ? "<<" : ">>", ...ALARM };
    case "open":
      return { label: "v", ...MINT };
    case "end":
      return { label: "end", ...FOG };
    case "other":
      return { label: "?", ...SODIUM };
  }
}

/** The most pressing lane decides what the gantry shows: a closed lane before a merge, a merge before a limit. */
export function gantryLook(g: MatrixGantry): GantryLook {
  const rank = (d: MatrixDisplay): number => ({ closed: 5, ahead: 4, speed: 3, other: 2, open: 1, end: 0 })[d.kind];
  const lanes = [...g.lanes].sort((a, b) => rank(b.display) - rank(a.display));
  const top = lanes[0]?.display;
  if (!top) return { label: "", ...FOG };
  if (top.kind === "speed") {
    // Lanes of one gantry normally agree; when they do not, the lowest limit is the one that binds.
    const speeds = g.lanes.flatMap((l) => (l.display.kind === "speed" ? [l.display] : []));
    const lowest = speeds.reduce((a, b) => (b.value < a.value ? b : a));
    return displayLook(lowest);
  }
  return displayLook(top);
}

export interface Explained {
  title: string;
  note: string;
}

/** What a sign means to a driver, in plain words. */
export function explainDisplay(d: MatrixDisplay): Explained {
  switch (d.kind) {
    case "speed":
      return d.enforced
        ? { title: `Speed limit ${d.value} km/h`, note: "Shown in a red ring: this is a legal limit, and speed cameras can enforce it." }
        : { title: `Advised speed ${d.value} km/h`, note: "Shown without a red ring: the road authority asks drivers to slow down, for example because traffic ahead is dense." };
    case "closed":
      return { title: "Lane closed", note: "The red cross means this lane is shut. Drivers must move out of it." };
    case "ahead":
      return { title: `Lane ends ahead, merge ${d.direction}`, note: "A flashing arrow warns that the lane is closed further on. Drivers should merge to the side the arrow points." };
    case "open":
      return { title: "Lane open", note: "A green arrow confirms that this lane is open again, for example after a closure." };
    case "end":
      return { title: "Restrictions end", note: "The earlier limit or instruction no longer applies from this gantry on." };
    case "other":
      return { title: `Sign: ${d.label}`, note: `NDW reports this sign as "${d.label}", which has no plain-language description here.` };
  }
}
