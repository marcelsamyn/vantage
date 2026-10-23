import type { Map as MapLibreMap } from "maplibre-gl";
import { Suspense, useCallback, useEffect, useState, type ReactElement } from "react";
import { contributions, lazyView } from "../../app/core/plugin";
import { Boundary } from "../../app/ui";
import type { LayerStatus, MapLayerContribution } from "./extension";
import { useCity, useEnabledLayers } from "./store";
import { ThingsLayer } from "./ThingsLayer";

/** Mount the things layer, plus every layer that is switched on and allowed at the current zoom. */
export function LayerHost({ map }: { map: MapLibreMap }): ReactElement {
  const enabled = useEnabledLayers();
  const zoom = useZoom(map);
  return (
    <>
      <Boundary name="Things" silent>
        <ThingsLayer map={map} />
      </Boundary>
      {contributions("mapLayers")
        .filter(({ item }) => enabled.has(item.id) && zoom >= (item.minZoom ?? 0))
        .map(({ item }) => (
          <LayerMount key={item.id} map={map} layer={item} />
        ))}
    </>
  );
}

function LayerMount({ map, layer }: { map: MapLibreMap; layer: MapLayerContribution }): ReactElement {
  const View = lazyView(layer.view);
  const report = useCallback((patch: Partial<LayerStatus>) => useCity.getState().report(layer.id, patch), [layer.id]);
  const claimFraming = useCallback(() => useCity.getState().claimFraming(layer.id), [layer.id]);
  useEffect(() => () => report({ loading: false, count: null }), [report]);
  return (
    <Boundary name={layer.title} silent onError={(err) => report({ error: err.message, loading: false })}>
      <Suspense fallback={null}>
        <View map={map} report={report} claimFraming={claimFraming} />
      </Suspense>
    </Boundary>
  );
}

/** Exact zoom, updated after each zoom gesture so the panel and layers use the same thresholds. */
export function useZoom(map: MapLibreMap): number {
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const update = (): void => setZoom(map.getZoom());
    map.on("zoomend", update);
    return () => {
      map.off("zoomend", update);
    };
  }, [map]);
  return zoom;
}
