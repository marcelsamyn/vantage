import { useMemo, type ReactElement } from "react";
import type { NearbyMapLayerProps } from "../city/extension";
import { CameraMarks } from "./CameraMarks";

/** Uses the same items as the nearby list; off-screen cameras remain City's edge pips. */
export default function NearbyCameraLayer({ map, items, selected, choose }: NearbyMapLayerProps): ReactElement {
  const cameras = useMemo(() => items.flatMap((item) => item.entity?.kind === "webcam" ? [item.entity.data] : []), [items]);
  const chosen = items.find((item) => item.key === selected)?.entity?.id ?? null;
  return <CameraMarks map={map} cameras={cameras} selected={chosen} choose={(camera) => {
    const item = items.find((item) => item.entity?.id === camera.id);
    if (item) choose(item);
  }} />;
}
