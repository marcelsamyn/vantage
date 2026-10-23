import { startTransition, Suspense, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type { PluginId } from "../../plugins";
import { ScreenActiveContext } from "../core/hooks";
import { useNav } from "../core/nav";
import { contributions, lazyView, type ScreenContribution } from "../core/plugin";
import { sfx } from "../core/sound";
import { Boundary, Scanning } from "../ui";

/**
 * Hosts screens. Only the active screen is mounted, except screens marked keepAlive,
 * which stay mounted (hidden) once visited so they come back instantly.
 */
export function Stage(): ReactElement {
  const requested = useNav((s) => s.active);
  // The navigation store updates synchronously, so the rail answers at once. The stage follows in a transition:
  // React renders the next screen in slices between frames, and mounting a heavy screen never blocks input.
  const [active, setActive] = useState(requested);
  useEffect(() => {
    startTransition(() => setActive(requested));
  }, [requested]);
  // Recorded at commit: a transition render that React throws away must not mark a screen as visited.
  const visited = useRef(new Set<string>());
  useEffect(() => {
    visited.current.add(active);
  }, [active]);

  useEffect(() => {
    sfx.open();
  }, [requested]);

  const screens = contributions("screen").filter(({ plugin, item }) => plugin.id === active || (item.keepAlive && visited.current.has(plugin.id)));

  return (
    <main className="stage">
      {screens.map(({ plugin, item }) => (
        <ScreenFrame key={plugin.id} id={plugin.id as PluginId} screen={item} active={plugin.id === active} />
      ))}
    </main>
  );
}

function ScreenFrame({ id, screen, active }: { id: PluginId; screen: ScreenContribution; active: boolean }): ReactElement {
  const View = lazyView(screen.view);
  const [entering, setEntering] = useState(active);

  useEffect(() => {
    if (!active) return;
    setEntering(true);
    const t = setTimeout(() => setEntering(false), 480);
    return () => clearTimeout(t);
  }, [active]);

  // The entrance toggles `entering` twice per visit. The screen's content is the same element both times, so React
  // skips it and only the wipe re-renders, instead of the whole screen.
  const content = useMemo(
    () => (
      <ScreenActiveContext.Provider value={active}>
        <Boundary name={screen.title} key={id}>
          <Suspense
            fallback={
              <div className="screen__loading">
                <Scanning label={`Loading ${screen.title}`} />
              </div>
            }
          >
            <View />
          </Suspense>
        </Boundary>
      </ScreenActiveContext.Provider>
    ),
    [active, id, screen.title, View],
  );

  return (
    <div className="screen" data-active={active} data-entering={entering} inert={!active} aria-label={screen.title}>
      {content}
      {/* After the content, so toggling it never shifts the screen's position and remounts it. */}
      {entering && <div className="screen__wipe" aria-hidden />}
    </div>
  );
}
