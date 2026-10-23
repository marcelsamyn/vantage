import { useEffect, type ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import { profile, useProfile } from "../../app/core/profile";
import { useMapView, type MapLayerProps } from "../city/extension";
import { fetchCameras } from "./client";
import { useMapCentre } from "./store";
import type { Webcam } from "./types";
import { CameraMarks } from "./CameraMarks";

const NO_CAMERAS: readonly Webcam[] = [];

/**
 * Ask again on this period while the map stands still, as well as after every move. Most operators publish a new
 * picture about every five minutes, and directory areas that were still loading join the next answer.
 */
const REFRESH_MS = 5 * 60_000;
/** Public street cameras you can look through, from the operators that publish them as open data. */
export default function WebcamLayer({ map, report }: MapLayerProps): ReactElement {
  const view = useMapView(map);
  const key = `${view.west.toFixed(2)},${view.south.toFixed(2)},${view.east.toFixed(2)},${view.north.toFixed(2)}`;
  const { data, error, loading } = usePoll((signal) => fetchCameras(view, signal), REFRESH_MS, [key]);
  const selected = useProfile((s) => (s.entity?.kind === "webcam" ? s.entity.id : null));
  const setCentre = useMapCentre((s) => s.set);
  useEffect(() => {
    setCentre(view.center);
  }, [setCentre, view.center]);
  useEffect(() => {
    report({ loading: loading && !data, error: error?.message ?? (data?.failed.length ? `Unavailable: ${data.failed.join(", ")}` : null), count: data?.cameras.length ?? null });
  }, [report, data, error, loading]);

  return <CameraMarks map={map} cameras={data?.cameras ?? NO_CAMERAS} selected={selected} choose={(c) => profile.open({ kind: "webcam", id: c.id, data: c })} />;
}
