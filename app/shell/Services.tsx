import { Suspense, type ReactElement } from "react";
import { feed } from "../core/feed";
import { BackgroundContext } from "../core/hooks";
import { contributions, lazyView } from "../core/plugin";
import { Boundary } from "../ui";

/**
 * Mounts every plugin's background watcher once, at boot. Watchers keep polling while the tab is hidden, at most
 * once a minute (`HIDDEN_PERIOD_MS`). A crashing watcher reports itself and stops alone.
 */
export function Services(): ReactElement {
  return (
    <BackgroundContext.Provider value={true}>
      {contributions("services").map(({ plugin, item }) => {
        const View = lazyView(item.view);
        return (
          <Boundary
            key={item.id}
            name={item.id}
            silent
            onError={(err) => feed({ level: "alert", source: "core", title: `${plugin.name} watcher stopped`, detail: err.message })}
          >
            <Suspense fallback={null}>
              <View />
            </Suspense>
          </Boundary>
        );
      })}
    </BackgroundContext.Provider>
  );
}
