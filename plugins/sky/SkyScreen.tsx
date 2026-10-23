import { motion } from "motion/react";
import { Suspense, useCallback, useMemo, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { noCompassReason, requestCompass, useCompass } from "../../app/core/heading";
import { useNow, useStoredState } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { contributions, lazyView } from "../../app/core/plugin";
import { profile, useProfile } from "../../app/core/profile";
import { Boundary, Empty, Panel, Scanning, Scramble, Toggle } from "../../app/ui";
import { compassPoint, type LatLon } from "../../shared/geo";
import type { SkyLayerContribution, SkyTarget } from "./extension";
import { Radar } from "./Radar";
import { Sight } from "./Sight";
import "./sky.css";

/** Sky: everything above your horizon on one radar — aircraft, satellites, the Sun, the Moon, stars. */
export default function SkyScreen(): ReactElement {
  const here = useLocation((s) => s.here);
  const orientation = useCompass((s) => s.enabled);
  const layers = useMemo(() => contributions("skyLayers").map(({ item }) => item), []);
  const [enabled, setEnabled] = useStoredState<string[]>("sky:layers", layers.filter((l) => l.defaultOn).map((l) => l.id));
  const [targets, setTargets] = useState<Record<string, SkyTarget[]>>({});
  const selected = useProfile((s) => (s.entity ? `${s.entity.kind}:${s.entity.id}` : null));
  const observer = useMemo<LatLon | null>(() => (here ? { lat: here.lat, lon: here.lon } : null), [here?.lat, here?.lon]);

  const visible = useMemo(() => layers.filter((l) => enabled.includes(l.id)).flatMap((l) => targets[l.id] ?? []), [layers, enabled, targets]);
  const overhead = useMemo(() => visible.filter((t) => t.el > 0).sort((a, b) => Number(Boolean(a.background)) - Number(Boolean(b.background)) || b.el - a.el), [visible]);
  const selectedTarget = visible.find((t) => t.entity && `${t.entity.kind}:${t.entity.id}` === selected) ?? null;
  // Sky layers report targets several times a second; the side panels do not use them, so they render once per place.
  const panels = useMemo(
    () =>
      observer &&
      contributions("skyPanels")
        .sort((a, b) => (a.item.order ?? 50) - (b.item.order ?? 50))
        .map(({ item }) => {
          const View = lazyView(item.view);
          return (
            <Panel key={item.id} title={item.title}>
              <Boundary name={item.title}>
                <Suspense fallback={<Scanning label="Calculating" />}>
                  <View observer={observer} />
                </Suspense>
              </Boundary>
            </Panel>
          );
        }),
    [observer],
  );

  if (!observer) {
    return (
      <div className="sky v-atmosphere">
        <Empty title="Location needed" center>
          The sky depends on where you stand. Allow location, or pin a place from the command palette.
        </Empty>
      </div>
    );
  }

  const toggle = (id: string, on: boolean): void => {
    setEnabled((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
    if (!on) setTargets((prev) => ({ ...prev, [id]: [] }));
  };

  return (
    <div className="sky v-atmosphere">
      {layers
        .filter((l) => enabled.includes(l.id))
        .map((l) => (
          <LayerMount key={l.id} layer={l} observer={observer} onReport={setTargets} />
        ))}

      <section className="sky-stage" aria-label={orientation ? "Phone sky view" : "Sky radar"}>
        {orientation ? <Sight targets={visible} selectedId={selectedTarget?.id ?? null} onSelect={(t) => t.entity && profile.open(t.entity)} /> : <Radar targets={visible} selectedId={selectedTarget?.id ?? null} onSelect={(t) => t.entity && profile.open(t.entity)} />}
        <div className="sky-corner sky-corner--tl">
          <div className="v-eyebrow v-eyebrow--ice">
            <Scramble text="Sky above you" />
          </div>
          <div className="sky-title">{orientation ? "Point at the sky" : "Sky radar"}</div>
          <div className="sky-meta num">
            {fmt.coord(observer.lat, observer.lon)} · <Clock />
          </div>
          <OrientationControl />
        </div>
        <div className="sky-corner sky-corner--bl num">
          <span>
            {overhead.length} above horizon · {visible.length} tracked
          </span>
          <span className="faint">{orientation ? "Point the back of your phone · compass positions are approximate" : "Zenith at centre · horizon at rim · north up"}</span>
        </div>
      </section>

      <aside className="sky-side">
        <Panel title="Layers">
          {layers.length === 0 && <p className="dim">No plugin contributes a sky layer yet.</p>}
          {layers.map((l) => (
            <div key={l.id} title={l.description}>
              <Toggle
                checked={enabled.includes(l.id)}
                onChange={(v) => toggle(l.id, v)}
                label={
                  <>
                    {l.title}
                    {/* Touch screens cannot hover for the tooltip, so they show the description in the row. */}
                    <span className="sky-layer__desc">{l.description}</span>
                  </>
                }
                swatch={l.swatch}
                count={enabled.includes(l.id) ? (targets[l.id]?.filter((t) => t.el > 0).length ?? "…") : undefined}
              />
            </div>
          ))}
        </Panel>

        <Panel title={`Overhead now · ${overhead.length}`} flush>
          {overhead.length === 0 && (
            <div style={{ padding: 16 }}>
              <Scanning label="Watching the sky" />
            </div>
          )}
          <ul className="sky-list">
            {overhead.slice(0, 14).map((t, i) => (
              <motion.li key={t.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(i, 8) * 0.03 }}>
                <button type="button" className="v-row sky-row" aria-selected={t.id === selectedTarget?.id} onClick={() => t.entity && profile.open(t.entity)} disabled={!t.entity}>
                  <span className={`sky-swatch sky-swatch--${t.tone}`} />
                  <span className="v-row__main">
                    <span className="v-row__title" style={{ display: "block" }}>
                      {t.label}
                    </span>
                    {t.detail && <span className="v-row__sub" style={{ display: "block" }}>{t.detail}</span>}
                  </span>
                  <span className="sky-look num">
                    {Math.round(t.el)}° {compassPoint(t.az)}
                  </span>
                </button>
              </motion.li>
            ))}
          </ul>
        </Panel>

        {panels}
      </aside>
    </div>
  );
}

function OrientationControl(): ReactElement {
  const enabled = useCompass((s) => s.enabled);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const toggle = async (on: boolean): Promise<void> => {
    if (asking) return;
    setError(null);
    if (!on) {
      useCompass.getState().setEnabled(false);
      return;
    }
    setAsking(true);
    try {
      const state = await requestCompass();
      const reason = noCompassReason(state);
      if (reason) setError(reason);
      else useCompass.getState().setEnabled(true);
    } catch (err: unknown) {
      setError(errorMessage(err));
    } finally {
      setAsking(false);
    }
  };
  return (
    <div className="sky-orientation">
      <Toggle checked={enabled} onChange={(on) => void toggle(on)} label={asking ? "Requesting orientation access" : "Phone orientation"} />
      <p>{error ?? "Shared with Map and Around me."}</p>
    </div>
  );
}

/** The local time, in its own component so the per-second tick re-renders this line only. */
function Clock(): ReactElement {
  const now = useNow(1000);
  return <>{fmt.clock(now, true)}</>;
}

function LayerMount({ layer, observer, onReport }: { layer: SkyLayerContribution; observer: LatLon; onReport: (fn: (prev: Record<string, SkyTarget[]>) => Record<string, SkyTarget[]>) => void }): ReactElement {
  const View = lazyView(layer.view);
  const report = useCallback((list: SkyTarget[]) => onReport((prev) => ({ ...prev, [layer.id]: list })), [layer.id, onReport]);
  return (
    <Boundary name={layer.title} silent>
      <Suspense fallback={null}>
        <View observer={observer} report={report} />
      </Suspense>
    </Boundary>
  );
}
