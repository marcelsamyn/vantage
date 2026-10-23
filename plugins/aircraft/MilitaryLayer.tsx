import type { ReactElement } from "react";
import { MAP_INK, type MapLayerProps } from "../city/extension";
import { fetchMilitary } from "./client";
import { modelName } from "./models";
import { WorldLayer, type WorldLayerSpec } from "./WorldLayer";

const SPEC: WorldLayerSpec = {
  id: "aircraft-military",
  load: fetchMilitary,
  intervalMs: 30_000,
  ink: MAP_INK.bone,
  pulse: false,
  label: (a) => [a.callsign ?? a.registration, modelName(a.typeCode)].filter(Boolean).join(" · ") || a.hex.toUpperCase(),
  labelMinZoom: 5,
};

/** Military aircraft anywhere in the world whose transponders volunteer receivers hear. */
export default function MilitaryLayer(props: MapLayerProps): ReactElement {
  return <WorldLayer {...props} spec={SPEC} />;
}
