import { AJAXError, type ErrorEvent } from "maplibre-gl";
import { useEffect, useMemo, useRef } from "react";
import { usePoll } from "../../app/core/hooks";
import { useSetting } from "../../app/core/settings";
import { addMapLayers, type MapLayerProps } from "../city/extension";
import { fetchTrafficConfig } from "./client";
import { flowLayers, type FlowStyle } from "./flow-style";
import { settings } from "./settings";

const SOURCE = "traffic-flow";

/** The server's own explanation of a failed tile, such as spent TomTom credits. */
async function serverMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof AJAXError)) return null;
  const body: unknown = await error.body.text().then((t): unknown => JSON.parse(t)).catch(() => null);
  if (typeof body !== "object" || body === null || !("error" in body)) return null;
  const { error: detail } = body;
  return typeof detail === "object" && detail !== null && "message" in detail && typeof detail.message === "string" ? detail.message : null;
}

function useFlowStyle(): FlowStyle {
  const measure = useSetting(settings.flowMeasure);
  const palette = useSetting(settings.flowPalette);
  const roads = useSetting(settings.flowRoads);
  const free = useSetting(settings.flowFree);
  const closures = useSetting(settings.flowClosures);
  const glow = useSetting(settings.flowGlow);
  const directions = useSetting(settings.flowDirections);
  const width = useSetting(settings.flowWidth);
  const opacity = useSetting(settings.flowOpacity);
  return useMemo(
    () => ({ measure, palette, roads, free, closures, glow, directions, width, opacity }),
    [measure, palette, roads, free, closures, glow, directions, width, opacity],
  );
}

export default function FlowLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll(fetchTrafficConfig, 60_000, []);
  const style = useFlowStyle();
  const on = data?.tomtom === true;
  // The source effect must re-run only when the layer effect does, or it would leave the source without layers.
  const reportRef = useRef(report);
  reportRef.current = report;
  useEffect(
    () =>
      report({
        loading,
        count: null,
        error:
          error?.message ??
          (data && !data.tomtom
            ? "Set VANTAGE_TOMTOM_KEY in the server's .env and restart VANTAGE. See Traffic for setup."
            : null),
      }),
    [data, loading, error, report],
  );

  // The source outlives style changes, so changing a setting redraws the tiles already loaded without fetching again.
  useEffect(() => {
    if (!on) return;
    map.addSource(SOURCE, {
      type: "vector",
      tiles: [`${location.origin}/api/traffic/flow?z={z}&x={x}&y={y}`],
      // MapLibre spans 512 px with each vector tile, a quarter of the requests the 256 px raster tiles needed. Past
      // zoom 16 it scales the zoom-16 tile, whose 4,096-unit grid is still finer than a pixel.
      maxzoom: 16,
      attribution: "© TomTom",
    });
    const failed = (e: ErrorEvent): void => {
      if (!("sourceId" in e) || e.sourceId !== SOURCE || !e.error) return;
      const cause = e.error;
      void serverMessage(cause).then((message) =>
        reportRef.current({
          error: message ?? `Traffic flow could not load. Check the TomTom key and service access. ${cause.message}`,
        }),
      );
    };
    map.on("error", failed);
    return () => {
      map.off("error", failed);
      if (!map.style || !map.getSource(SOURCE)) return;
      // React runs unmount cleanups in declaration order, so the style layers may still hold the source.
      for (const layer of map.getStyle().layers) if ("source" in layer && layer.source === SOURCE) map.removeLayer(layer.id);
      map.removeSource(SOURCE);
    };
  }, [map, on]);

  // Declared after the source effect, so the source exists when the layers are added.
  useEffect(() => {
    if (!on) return;
    const layers = flowLayers(SOURCE, style);
    addMapLayers(map, layers, true);
    return () => {
      if (!map.style) return;
      for (const layer of layers) if (map.getLayer(layer.id)) map.removeLayer(layer.id);
    };
  }, [map, on, style]);
  return null;
}
