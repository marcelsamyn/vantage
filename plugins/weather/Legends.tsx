import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import "./weather.css";

/**
 * The legends of the weather layers share one column in the City map's dock, the strip above the status line that
 * the Time machine also uses. Each layer renders its legend with `<Legend>`; the dock stacks them above the other
 * controls, so legends never sit on top of each other or of the Time machine panel.
 */

interface LegendHost {
  element: HTMLElement | null;
  set: (element: HTMLElement | null) => void;
}

const useLegendHost = create<LegendHost>((set) => ({ element: null, set: (element) => set({ element }) }));

/** The dock slot (a `mapControls` view). It is empty, and takes no room, until a layer shows a legend. */
export default function LegendDock(): ReactElement {
  return <div ref={useLegendHost.getState().set} className="weather-legends" />;
}

/** A layer's legend, placed in the dock. Renders nothing until the dock slot exists. */
export function Legend({ children }: { children: ReactNode }): ReactElement | null {
  const element = useLegendHost((s) => s.element);
  return element ? createPortal(children, element) : null;
}
