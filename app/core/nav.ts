import { useEffect } from "react";
import { create } from "zustand";
import type { PluginId } from "../../plugins";
import { pluginById } from "./plugin";

/**
 * Navigation between screens, plus intents: a request for a screen to do something when it opens,
 * e.g. go("net", { action: "trace", arg: "1.1.1.1" }). Intents are how plugins talk to each other
 * without importing each other.
 */
export interface Intent {
  screen: PluginId;
  action: string;
  arg?: string;
}

interface NavStore {
  active: PluginId;
  intent: Intent | null;
  go: (screen: PluginId, intent?: Omit<Intent, "screen">) => void;
  clearIntent: () => void;
}

function fromHash(): PluginId | null {
  const id = location.hash.replace(/^#\/?/, "");
  return pluginById(id)?.contributes.screen ? (id as PluginId) : null;
}

export const useNav = create<NavStore>((set) => ({
  active: "home",
  intent: null,
  go: (screen, intent) => {
    if (fromHash() !== screen) history.pushState(null, "", `#/${screen}`);
    set({ active: screen, intent: intent ? { ...intent, screen } : null });
  },
  clearIntent: () => set({ intent: null }),
}));

/** Screens as narrow as the phone layout (the tab bar) open on what is around you. */
const PHONE = "(max-width: 720px)";

/**
 * Read the screen from the URL once plugins are installed, and follow back/forward. Without a screen in the URL,
 * a phone starts on City in its "Around me" mode and a wider screen on the Briefing.
 */
export function startNavigation(): void {
  const initial = fromHash();
  if (initial) useNav.setState({ active: initial });
  else if (matchMedia(PHONE).matches) useNav.setState({ active: "city", intent: { screen: "city", action: "around" } });
  window.addEventListener("popstate", () => {
    const id = fromHash();
    if (id) useNav.setState({ active: id, intent: null });
  });
}

/** Shorthand usable outside React. */
export const go = (screen: PluginId, intent?: Omit<Intent, "screen">): void => useNav.getState().go(screen, intent);

/** Run `handler` whenever an intent addressed to `screen` arrives (including one waiting from before mount). */
export function useIntent(screen: PluginId, handler: (intent: Intent) => void): void {
  const intent = useNav((s) => s.intent);
  useEffect(() => {
    if (intent?.screen !== screen) return;
    useNav.getState().clearIntent();
    handler(intent);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent, screen]);
}
