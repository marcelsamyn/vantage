import { Camera, Crosshair, Map, RefreshCw, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { noCompassReason, requestCompass, useCompass, useOrientation } from "../../app/core/heading";
import { useNow, useRunning } from "../../app/core/hooks";
import { clearManualLocation, useLocation, useWatchLocation } from "../../app/core/location";
import { go } from "../../app/core/nav";
import { nearbyContributions, useNearby } from "../../app/core/nearby";
import { profile, useProfile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, Page, Panel, Scanning } from "../../app/ui";
import { compassPoint } from "../../shared/geo";
import { useSource } from "../scan/client";
import { cameraFrame, lensMarkers } from "./projection";
import "./lens.css";

const GROUPS = [
  { id: "landmarks", label: "Landmarks", sources: ["places.nearby"] },
  { id: "transit", label: "Transit", sources: ["transit.nearby"] },
  { id: "cameras", label: "Cameras", sources: ["grid.cameras", "webcams.nearby"] },
] as const;
const RADIUS_M = 1000;

export default function LensScreen(): ReactElement {
  const here = useLocation((s) => s.here);
  const locating = useLocation((s) => s.status === "locating");
  const locationNote = useLocation((s) => s.note);
  const gps = here?.source === "gps";
  const source = useSource("environment");
  const running = useRunning();
  const live = source.status === "live";
  const pose = useOrientation(live && gps);
  const compassState = useCompass((s) => s.state);
  const compassEnabled = useCompass((s) => s.enabled);
  const [compassError, setCompassError] = useState<string | null>(null);
  const units = useSettings((s) => s.units);
  const selected = useProfile((s) => s.entity);
  const [enabled, setEnabled] = useState<readonly string[]>(GROUPS.map((g) => g.id));
  const [correction, setCorrection] = useState(0);
  const sources = useMemo(() => {
    const ids = new Set<string>(GROUPS.filter((g) => enabled.includes(g.id)).flatMap((g) => [...g.sources]));
    return nearbyContributions().filter((s) => ids.has(s.id));
  }, [enabled]);
  const nearby = useNearby(here, RADIUS_M, sources);
  const items = nearby.items.filter((item) => item.entity && item.bearing !== null);
  const now = useNow(15_000);
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useWatchLocation(live && gps);
  useEffect(() => {
    if (!running) source.stop();
  }, [running, source.stop]);
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const enableOrientation = (): void => {
    setCompassError(null);
    useCompass.getState().setEnabled(true);
    void requestCompass().catch((err: unknown) => setCompassError(`Orientation access failed: ${errorMessage(err)}. Allow motion and orientation in your browser settings.`));
  };
  const start = (): void => {
    enableOrientation();
    if (!gps) clearManualLocation();
    void source.startCamera();
  };
  const frame = cameraFrame(size.width, size.height, source.size?.width ?? 0, source.size?.height ?? 0);
  const markers = live && gps && pose ? lensMarkers(items, pose, frame, correction) : [];
  const facing = pose ? compassPoint(Math.atan2(pose.forward[0], pose.forward[1]) * 180 / Math.PI) : null;
  const orientationProblem = compassError ?? noCompassReason(compassState);
  const isSelected = (kind: string, id: string): boolean => selected?.kind === kind && selected.id === id;

  return (
    <Page eyebrow="ctOS" title="Lens" lede="Point your phone at the city. Tap a direction marker to open its profile." actions={
      <>
        {live ? <Button icon={<Square size={14} />} onClick={source.stop}>Stop camera</Button> : <Button variant="primary" icon={<Camera size={14} />} onClick={start} disabled={source.status === "starting"}>{source.status === "starting" ? "Opening camera" : "Start lens"}</Button>}
        <Button icon={<Map size={14} />} onClick={() => go("city", { action: "around" })}>Open map</Button>
      </>
    }>
      <div className="lens-layout">
        <section className="lens-view" aria-label="Camera and nearby direction markers">
          <div className="lens-frame" ref={frameRef}>
            <video ref={source.videoRef} className="lens-video" autoPlay muted playsInline onLoadedMetadata={source.onVideoReady} onResize={source.onVideoReady} aria-label="Rear camera" hidden={!live && source.status !== "starting"} />
            {!live ? (
              <div className="lens-state" role="status">
                <Crosshair size={40} strokeWidth={1} aria-hidden />
                <Empty center title={source.status === "starting" ? "Opening your rear camera" : source.status === "denied" ? "Camera access denied" : source.status === "error" ? "Camera unavailable" : "Look closer"}>
                  {source.status === "starting" ? <Scanning label="Allow camera access when your browser asks" /> : source.problem ? <>{source.problem}{source.status === "denied" && " Allow camera access in your browser settings, then press Start lens again."}</> : "Open this screen on your phone and start the lens. Landmarks, stops and cameras appear in the direction you point."}
                </Empty>
              </div>
            ) : !gps ? (
              <div className="lens-state"><Empty center title="Use your phone's location" action={<Button onClick={clearManualLocation} disabled={locating}>{locating ? "Finding your position" : "Locate me"}</Button>}>{locationNote ?? "A saved pin or internet location cannot line up with your camera. Allow location access, or use the nearby list."}</Empty></div>
            ) : !pose ? (
              <div className="lens-state"><Empty center title={orientationProblem ? "Phone orientation unavailable" : "Waiting for phone orientation"} action={!compassEnabled || compassState === "ask" ? <Button onClick={enableOrientation}>Enable orientation</Button> : undefined}>{orientationProblem ?? "Hold the screen toward you and point the back of your phone down the street. You can also open profiles from the nearby list."}</Empty></div>
            ) : (
              <>
                <Crosshair className="lens-reticle" size={28} strokeWidth={1} aria-hidden />
                <div className="lens-reading num">{facing} · {markers.length} markers in view</div>
                {markers.map(({ item, x, y }) => item.entity && (
                  <button key={item.key} type="button" className="lens-marker" data-tone={item.tone} data-selected={isSelected(item.entity.kind, item.entity.id) || undefined} style={{ left: x, top: y }} onClick={() => item.entity && profile.open(item.entity)} aria-label={`Open ${item.title}, ${fmt.distance(item.distanceM, units)}`}>
                    <Crosshair size={16} aria-hidden />
                    <span className="lens-marker__title">{item.title}</span>
                    <span className="lens-marker__distance num">{fmt.distance(item.distanceM, units)}</span>
                  </button>
                ))}
                {markers.length === 0 && <p className="lens-direction-hint">{items.length > 0 ? "Turn toward a nearby place and keep the phone upright. Profiles are also in the list." : "No places found in view. Check the sources and nearby list."}</p>}
              </>
            )}
          </div>
          <div className="lens-caption">
            <span>Approximate directions, not visual identification.</span>
            {gps && here.accuracyM !== null && <span className="num">GPS accuracy ±{fmt.distance(here.accuracyM, units)}</span>}
          </div>
          {live && gps && pose && (
            <details className="lens-alignment">
              <summary>Adjust alignment</summary>
              <p>If the compass is offset, move the labels until a known landmark lines up. Distance and camera field of view can also affect placement.</p>
              <label className="lens-correction">Direction correction <output className="num">{correction}°</output><input type="range" min={-45} max={45} step={1} value={correction} onChange={(e) => setCorrection(Number(e.currentTarget.value))} aria-label="Direction correction" /></label>
              <Button size="sm" onClick={() => setCorrection(0)} disabled={correction === 0}>Reset alignment</Button>
            </details>
          )}
        </section>
        <Panel className="lens-nearby" title={`Nearby · ${fmt.distance(RADIUS_M, units)}`} actions={<Button size="sm" icon={<RefreshCw size={13} />} onClick={nearby.refresh} disabled={!here || sources.length === 0}>Refresh</Button>} flush>
          <div className="lens-filters" role="group" aria-label="Lens sources">
            {GROUPS.map((g) => <button type="button" className="lens-filter" key={g.id} aria-pressed={enabled.includes(g.id)} onClick={() => setEnabled((prev) => prev.includes(g.id) ? prev.filter((id) => id !== g.id) : [...prev, g.id])}>{g.label}</button>)}
          </div>
          {!here ? <Empty title="Location needed" action={<Button onClick={clearManualLocation} disabled={locating}>{locating ? "Finding your position" : "Locate me"}</Button>}>{locationNote ?? "Allow location access to find nearby places."}</Empty> : sources.length === 0 ? <Empty title="No sources selected">Switch on Landmarks, Transit or Cameras.</Empty> : <>
            {!gps && <p className="lens-list-note">Places near {here.label ?? "your saved location"}. Use GPS to show camera markers.</p>}
            {!nearby.settled && <div className="lens-loading"><Scanning label="Finding nearby places" /></div>}
            {items.length === 0 && nearby.settled && <Empty title={nearby.providers.some((p) => p.error) ? "Nearby sources could not find places" : "No places found nearby"}>Try Refresh, choose another source, or explore the map.</Empty>}
            <ul className="lens-items">
              {items.map((item) => item.entity && <li key={item.key}>
                <button type="button" className="lens-item" data-selected={isSelected(item.entity.kind, item.entity.id) || undefined} onClick={() => item.entity && profile.open(item.entity)}>
                  <span className="lens-item__head"><span>{item.title}</span><span className="lens-item__distance num">{fmt.distance(item.distanceM, units)}</span></span>
                  <span className="lens-item__detail">{item.detail}{item.startsAt !== undefined && ` · ${fmt.until(item.startsAt, now)}`}</span>
                  <span className="lens-item__source">{sources.find((s) => s.id === item.source)?.title} · {compassPoint(item.bearing ?? 0)}</span>
                </button>
              </li>)}
            </ul>
            <div className="lens-sources">
              {nearby.providers.map((p) => <div key={p.id}><span>{p.title}{p.loading ? " · updating" : ""}</span>{p.error && <p className="lens-source-error" role="status">{p.error}. Try Refresh.</p>}{p.attribution && <small>{p.attribution}</small>}</div>)}
            </div>
          </>}
        </Panel>
      </div>
    </Page>
  );
}
