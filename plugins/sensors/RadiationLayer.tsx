import type { ReactElement } from "react";
import type { MapLayerProps } from "../city/extension";
import { SensorLayer } from "./SensorLayer";

export default function RadiationLayer(props: MapLayerProps): ReactElement {
  return <SensorLayer kind="radiation" {...props} />;
}
