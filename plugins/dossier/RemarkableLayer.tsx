import { useEffect, useMemo } from "react";
import { usePoll } from "../../app/core/hooks";
import { useGeoJsonLayer, type MapLayerProps } from "../city/extension";
import { fetchRemarkableTrees } from "./client";
import { openSpot } from "./spot";
import { remarkableLayers, treeCollection } from "./tree-draw";

/** The remarkable-tree lists of Brussels and Paris, each tree with a ring and its name. */
export default function RemarkableLayer({ map, report }: MapLayerProps): null {
  const { data, error, loading } = usePoll((signal) => fetchRemarkableTrees(signal), null, []);
  useEffect(() => report({ loading: loading && !data, error: error?.message ?? null, count: data?.trees.length ?? null }), [report, data, error, loading]);
  const points = useMemo(() => (data ? treeCollection(data.trees) : null), [data]);

  useGeoJsonLayer(map, {
    id: "dossier-remarkable",
    data: points,
    fadeBy: "id",
    clickable: ["dossier-remarkable-ring"],
    onClick: (f) => {
      const hit = data?.trees.find((t) => t.id === f.properties.id);
      if (hit) openSpot({ id: hit.id, name: hit.name, kind: "tree", context: "Remarkable tree", lat: hit.lat, lon: hit.lon });
    },
    layers: remarkableLayers,
  });
  return null;
}
