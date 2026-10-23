import type { Map as MapLibreMap } from "maplibre-gl";
import { Suspense, type ReactElement } from "react";
import { byOrder, contributions, lazyView } from "../../app/core/plugin";
import { Boundary } from "../../app/ui";
import type { MapControlContribution, MapMode } from "./extension";

/** Mount every plugin's floating map control in the dock above the status line. */
export function MapControlHost({ map, mode }: { map: MapLibreMap; mode: MapMode }): ReactElement {
  return (
    <div className="city-dock">
      {contributions("mapControls")
        .sort((a, b) => byOrder(a.item, b.item))
        .map(({ item }) => (
          <ControlMount key={item.id} map={map} mode={mode} control={item} />
        ))}
    </div>
  );
}

function ControlMount({ map, mode, control }: { map: MapLibreMap; mode: MapMode; control: MapControlContribution }): ReactElement {
  const View = lazyView(control.view);
  return (
    <Boundary name={control.title}>
      <Suspense fallback={null}>
        <View map={map} mode={mode} />
      </Suspense>
    </Boundary>
  );
}
