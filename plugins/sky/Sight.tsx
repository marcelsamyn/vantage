import { Crosshair } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { noCompassReason, useCompass, useOrientation } from "../../app/core/heading";
import { clearManualLocation, useLocation } from "../../app/core/location";
import { Button, Empty, Scanning } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import type { SkyTarget } from "./extension";
import { projectSight } from "./sight-projection";

export function Sight({ targets, selectedId, onSelect }: { targets: SkyTarget[]; selectedId: string | null; onSelect: (target: SkyTarget) => void }): ReactElement {
  const here = useLocation((s) => s.here);
  const gps = here?.source === "gps";
  const pose = useOrientation(gps);
  const state = useCompass((s) => s.state);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const reason = noCompassReason(state);
  const projected = pose ? targets.filter((t) => t.el >= 0).flatMap((t) => {
    const at = projectSight(t.az, t.el, pose, size.width, size.height);
    return at ? [{ target: t, at }] : [];
  }) : [];
  const forward = pose?.forward;
  const az = forward ? Math.atan2(forward[0], forward[1]) * 180 / Math.PI : 0;
  const el = forward ? Math.asin(Math.max(-1, Math.min(1, forward[2]))) * 180 / Math.PI : 0;

  return (
    <div ref={wrap} className="sky-sight" aria-label="Sky in the direction your phone points">
      {!gps ? (
        <Empty title="Use your phone's location" center action={<Button onClick={clearManualLocation}>Locate me</Button>}>
          Your pin or internet position is not where your phone stands. Allow location to line up the sky.
        </Empty>
      ) : reason ? (
        <Empty title="Phone orientation unavailable" center>{reason}</Empty>
      ) : !pose ? (
        <Empty title="Waiting for phone orientation" center>
          {state === "ask" ? "Switch phone orientation off and on, then allow access when your browser asks." : "Hold the screen toward you and point the back of your phone at the sky. If no tilt reading arrives, switch off phone orientation to use the radar."}
          <Scanning label="Waiting for heading and tilt" />
        </Empty>
      ) : (
        <>
          <Crosshair className="sky-sight__reticle" size={28} strokeWidth={1} aria-hidden />
          {projected.map(({ target, at }) => (
            <button key={target.id} type="button" className="sky-sight__target" data-selected={target.id === selectedId || undefined} style={{ left: at.x, top: at.y }} onClick={() => onSelect(target)} disabled={!target.entity} aria-label={`${target.label}, ${Math.round(target.el)}° up, ${compassPoint(target.az)}${target.detail ? `, ${target.detail}` : ""}`}>
              <span className={`sky-swatch sky-swatch--${target.tone}`} />
              <span className="sky-sight__label" style={{ left: `calc(50% + ${Math.max(80, Math.min(size.width - 80, at.x)) - at.x}px)` }} data-above={at.y > size.height - 60 || undefined}>{target.label}</span>
            </button>
          ))}
          <div className="sky-sight__reading num">{compassPoint(az)} · {Math.round(Math.abs(el))}° {el < 0 ? "down" : "up"} · {projected.length} in view</div>
          {projected.length === 0 && <p className="sky-sight__empty">No tracked objects in this direction. Turn or tilt your phone, or switch on more layers.</p>}
        </>
      )}
    </div>
  );
}
