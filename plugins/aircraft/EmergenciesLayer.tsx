import type { ReactElement } from "react";
import { MAP_INK, type MapLayerProps } from "../city/extension";
import { fetchEmergencies } from "./client";
import { emergencyOf } from "./emergency";
import { WorldLayer, type WorldLayerSpec } from "./WorldLayer";

const SPEC: WorldLayerSpec = {
  id: "aircraft-emergencies",
  load: fetchEmergencies,
  intervalMs: 45_000,
  ink: MAP_INK.alarm,
  pulse: true,
  label: (a) => `${a.callsign ?? a.registration ?? a.hex.toUpperCase()} · ${emergencyOf(a)?.code ?? "emergency"}`,
  labelMinZoom: 0,
};

/** Every aircraft squawking 7700, 7600 or 7500 anywhere in the world, pulsing in alarm red. Usually there are none. */
export default function EmergenciesLayer(props: MapLayerProps): ReactElement {
  return <WorldLayer {...props} spec={SPEC} />;
}
