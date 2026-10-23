import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { contributions } from "../../app/core/plugin";
import { thingSources, useThingRuns } from "../../app/core/things";
import { useCity, useEnabledLayers } from "./store";
import { RELIEF_ATTRIBUTION } from "./style";

/** Bottom-left readout: where the camera points, plus credits for every visible data source, on one line until tapped. */
export function Hud({ map, around }: { map: MapLibreMap; around: boolean }): ReactElement {
  const row = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const enabled = useEnabledLayers();

  // The camera moves every frame. Its readout is written straight to the DOM in the map's own frame, rather than
  // costing a React render per frame beside the map's drawing.
  useEffect(() => {
    const update = (): void => {
      const spans = row.current?.children;
      if (!spans) return;
      readout(map).forEach((text, i) => {
        const span = spans[i];
        if (span && span.textContent !== text) span.textContent = text;
      });
    };
    map.on("move", update);
    return () => {
      map.off("move", update);
    };
  }, [map]);

  // "Around me" hides the layers and shows what its providers found, so it credits those instead.
  const providers = useCity((s) => s.around?.providers);
  const runs = useThingRuns();
  const sources = around
    ? (providers ?? []).flatMap((p) => (p.count > 0 && p.attribution ? [p.attribution] : []))
    : [
        ...contributions("mapLayers").flatMap(({ item }) => (enabled.has(item.id) && item.attribution ? [item.attribution] : [])),
        ...thingSources().flatMap((s) => ((runs[s.id]?.things.length ?? 0) > 0 && s.attribution ? [s.attribution] : [])),
      ];
  const credits = ["© OpenStreetMap contributors", "OpenFreeMap", RELIEF_ATTRIBUTION, ...new Set(sources)];

  return (
    <div className="city-hud">
      <div ref={row} className="city-hud__row num">
        {readout(map).map((text, i) => (
          <span key={i}>{text}</span>
        ))}
      </div>
      <button type="button" className="city-hud__credits" aria-expanded={open} onClick={() => setOpen(!open)}>
        {credits.join(" · ")}
      </button>
    </div>
  );
}

/** Where the camera points, one string per span: the move handler replaces each span's text whole. */
function readout(map: MapLibreMap): string[] {
  const c = map.getCenter();
  return [fmt.coord(c.lat, c.lng), `Z ${map.getZoom().toFixed(1)}`, `HDG ${String(Math.round((map.getBearing() + 360) % 360)).padStart(3, "0")}°`, `TILT ${Math.round(map.getPitch())}°`];
}
