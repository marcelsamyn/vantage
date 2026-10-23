import type { ReactElement } from "react";
import type { MapLayerProps } from "../city/extension";
import { SensorLayer } from "./SensorLayer";

export default function AirLayer(props: MapLayerProps): ReactElement {
  return <SensorLayer kind="air" {...props} />;
}
