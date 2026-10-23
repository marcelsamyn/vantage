import type { ReactElement } from "react";
import type { MapLayerProps } from "../city/extension";
import { SensorLayer } from "./SensorLayer";

export default function NoiseLayer(props: MapLayerProps): ReactElement {
  return <SensorLayer kind="noise" {...props} />;
}
