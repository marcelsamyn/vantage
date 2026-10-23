import { Locate, LocateFixed } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState, type ReactElement } from "react";
import { useCompass } from "../../app/core/heading";
import { useLocation } from "../../app/core/location";
import { IconButton } from "../../app/ui";
import { inside } from "./around";
import { useCity } from "./store";

/** Whether your position projects inside the free part of the map, checked once per frame while the camera moves. */
function useYouInView(map: MapLibreMap): boolean {
  const here = useLocation((s) => s.here);
  const frame = useCity((s) => s.frame);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    if (!here) return;
    let raf = 0;
    // A booked frame stays booked; rebooking on every `move` would hold the check off while the camera moves.
    const check = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const p = map.project([here.lon, here.lat]);
        const c = map.getCanvas();
        setInView(inside(p, frame ?? { left: 0, top: 0, right: c.clientWidth, bottom: c.clientHeight }));
      });
    };
    check();
    map.on("move", check);
    return () => {
      cancelAnimationFrame(raf);
      map.off("move", check);
    };
  }, [map, here, frame]);
  return inView;
}

/**
 * The locate button. It stays in one place among the map controls and shows by its look whether the map is on you:
 * lit while the map follows you, bright and solid while you are off screen (or "Around me" no longer follows you),
 * plain otherwise. A tap brings the map back to you; in "Around me", and in Map mode facing your way, the map then
 * follows you again. Without a position it asks for one.
 */
export function LocateButton({ map, around }: { map: MapLibreMap; around: boolean }): ReactElement {
  const here = useLocation((s) => s.here);
  const locating = useLocation((s) => s.status === "locating");
  const following = useCity((s) => s.following);
  const facing = useCompass((s) => s.enabled);
  const inView = useYouInView(map);

  if (!here) {
    return (
      <IconButton label={locating ? "Finding your position" : "Find my position"} disabled={locating} onClick={() => void useLocation.getState().locate()}>
        <Locate size={16} />
      </IconButton>
    );
  }

  const lost = !following && (around || !inView);
  const back = (): void => {
    // A following map centres you itself, in the free part of the map and facing the right way.
    if (around || facing) {
      useCity.setState({ following: true });
      return;
    }
    map.flyTo({ center: [here.lon, here.lat], zoom: Math.max(map.getZoom(), 15.5), duration: 1400, essential: true });
  };
  return (
    <IconButton label={lost ? "Back to me" : "Centre on me"} on={following} aria-pressed={following} className="city-locate" data-lost={lost || undefined} onClick={back}>
      <LocateFixed size={16} />
    </IconButton>
  );
}
