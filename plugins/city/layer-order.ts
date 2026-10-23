import type { LayerSpecification, Map as MapLibreMap } from "maplibre-gl";

const ORDER_KEY = "vantage:layer-order";

interface LayerOrder {
  band: number;
  group: string;
}

function metadataOf(layer: LayerSpecification): object {
  const metadata: unknown = layer.metadata;
  return typeof metadata === "object" && metadata !== null ? metadata : {};
}

function readOrder(layer: LayerSpecification): LayerOrder | null {
  const metadata = metadataOf(layer);
  if (!(ORDER_KEY in metadata)) return null;
  const value: unknown = metadata[ORDER_KEY];
  if (typeof value !== "object" || value === null || !("band" in value) || !("group" in value)) return null;
  return typeof value.band === "number" && typeof value.group === "string" ? { band: value.band, group: value.group } : null;
}

/** Base labels must follow all ground geometry; an early water label is not an overlay boundary. */
export function labelsAboveGround(layers: readonly LayerSpecification[]): LayerSpecification[] {
  return [...layers.filter((layer) => layer.type !== "symbol"), ...layers.filter((layer) => layer.type === "symbol")];
}

/** Keep each group's internal order, but make the order between groups independent of mount time. */
export function mapLayerPlacement(layers: readonly LayerSpecification[], specs: readonly LayerSpecification[], belowLabels = false): { before: string | undefined; layers: LayerSpecification[] } {
  const first = specs[0];
  if (!first) return { before: undefined, layers: [] };
  const order: LayerOrder = {
    band: belowLabels ? (first.type === "raster" ? 0 : first.type === "fill" ? 1 : 2) : first.type === "circle" || first.type === "symbol" ? 4 : 3,
    group: first.id,
  };
  const next = layers.find((layer) => {
    const other = readOrder(layer);
    return other !== null && (other.band > order.band || (other.band === order.band && other.group > order.group));
  });
  const label = belowLabels ? layers.find((layer) => layer.type === "symbol" && readOrder(layer) === null) : undefined;
  const before = next && (!label || layers.indexOf(next) < layers.indexOf(label)) ? next.id : label?.id;
  return { before, layers: specs.map((spec) => ({ ...spec, metadata: { ...metadataOf(spec), [ORDER_KEY]: order } })) };
}

export function addMapLayers(map: Pick<MapLibreMap, "getStyle" | "addLayer">, specs: readonly LayerSpecification[], belowLabels = false): void {
  const placement = mapLayerPlacement(map.getStyle().layers, specs, belowLabels);
  for (const layer of placement.layers) map.addLayer(layer, placement.before);
}
