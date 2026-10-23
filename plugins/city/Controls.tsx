import { Box, Minus, Orbit, Plus } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState, type ReactElement } from "react";
import { useAnimationFrame } from "../../app/core/hooks";
import { IconButton } from "../../app/ui";
import { CompassButton } from "./Facing";
import { LocateButton } from "./Locate";

/**
 * Map controls: tilt, orbit, compass, locate, zoom. On a phone they sit in a row above the sheet, with locate at the
 * thumb's end; orbit and the zoom buttons stay on larger screens, where no pinch is at hand.
 */
export function Controls({ map, around }: { map: MapLibreMap; around: boolean }): ReactElement {
  // Only the side of 10° matters, so a tilt re-renders the controls once, not on every frame of it.
  const [flat, setFlat] = useState(() => map.getPitch() < 10);
  const [orbit, setOrbit] = useState(false);

  useEffect(() => {
    const update = (): void => setFlat(map.getPitch() < 10);
    map.on("pitch", update);
    return () => {
      map.off("pitch", update);
    };
  }, [map]);

  // Orbit: a slow camera drift around the centre, stopped by any user gesture. It is an ambient loop, so a
  // forgotten orbit rests with the page instead of redrawing the map all night.
  useAnimationFrame((dt) => {
    if (dt > 0) map.setBearing(map.getBearing() + dt * 4);
  }, orbit);
  useEffect(() => {
    if (!orbit) return;
    const stop = (): void => setOrbit(false);
    map.on("mousedown", stop);
    map.on("touchstart", stop);
    map.on("wheel", stop);
    return () => {
      map.off("mousedown", stop);
      map.off("touchstart", stop);
      map.off("wheel", stop);
    };
  }, [map, orbit]);

  return (
    <div className="v-panel city-controls">
      <IconButton label={flat ? "Tilt to 3D" : "Flatten to 2D"} on={!flat} onClick={() => map.easeTo({ pitch: flat ? 58 : 0, duration: 900 })}>
        <Box size={16} />
      </IconButton>
      <IconButton label={orbit ? "Stop orbit" : "Orbit slowly"} on={orbit} className="city-controls__wide" onClick={() => setOrbit(!orbit)}>
        <Orbit size={16} />
      </IconButton>
      <CompassButton map={map} />
      <LocateButton map={map} around={around} />
      <span className="city-controls__rule city-controls__wide" />
      <IconButton label="Zoom in" className="city-controls__wide" onClick={() => map.zoomIn({ duration: 300 })}>
        <Plus size={16} />
      </IconButton>
      <IconButton label="Zoom out" className="city-controls__wide" onClick={() => map.zoomOut({ duration: 300 })}>
        <Minus size={16} />
      </IconButton>
    </div>
  );
}
