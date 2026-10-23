import type { CSSProperties, ReactElement } from "react";
import { useStoredState } from "../../app/core/hooks";
import { useProfile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Empty, LiveDot, Panel, Scanning, Segmented } from "../../app/ui";
import { openSpacecraft } from "./client";
import { CENTER, SIZE, makeScale, place, type Placed, type Scale, type ScaleMode } from "./scale";
import { AU_KM, distanceWords, lightTimeWords, signalLeftWords } from "./physics";
import type { DsnLink, DsnSnapshot, SystemBody, SystemSnapshot } from "./types";

const EARTH_ID = 399;
/** The probes everyone knows by name; they keep their labels even when no dish is listening. */
const NOTABLE = new Set([-31, -32, -98]);
/** Planets whose labels would collide at the centre of the whole-system view. */
const CROWDED_PLANETS = new Set([199, 299, 499]);
/** A link shorter than this on screen is drawn as the spacecraft sitting on Earth. */
const MIN_LINE = 14;

const SCALE_OPTIONS = [
  { value: "system", label: "Whole system" },
  { value: "inner", label: "Inner planets" },
] as const satisfies readonly { value: ScaleMode; label: string }[];

/** One link per spacecraft; when two complexes hear the same one, Madrid's is shown. */
function linkBySpacecraft(links: readonly DsnLink[]): Map<number, DsnLink> {
  const map = new Map<number, DsnLink>();
  for (const link of links) {
    const have = map.get(link.spacecraft.naifId);
    if (!have || link.complexId === "mdscc") map.set(link.spacecraft.naifId, link);
  }
  return map;
}

const pct = (n: number): CSSProperties => ({ left: `${(n / SIZE) * 100}%` });
const spot = (p: Placed): CSSProperties => ({ left: `${p.left}%`, top: `${p.top}%` });

interface Drawn {
  body: SystemBody;
  at: Placed;
}

function draw(bodies: readonly SystemBody[], scale: Scale): Drawn[] {
  return bodies.flatMap((body) => {
    const at = place(body, scale);
    return at ? [{ body, at }] : [];
  });
}

function Stage({ system, dsn }: { system: SystemSnapshot; dsn: DsnSnapshot | undefined }): ReactElement {
  const [mode, setMode] = useStoredState<ScaleMode>("deepspace:scale", "system");
  const units = useSettings((s) => s.units);
  const open = useProfile((s) => s.entity);
  const selected = open?.kind === "spacecraft" ? Number(open.id) : null;

  const farthestAu = Math.max(0, ...system.bodies.filter((b) => b.kind === "probe").map((b) => b.distSunKm / AU_KM));
  const scale = makeScale(mode, farthestAu);
  const planets = draw(system.bodies.filter((b) => b.kind === "planet"), scale);
  const probes = draw(system.bodies.filter((b) => b.kind === "probe"), scale);
  const earth = planets.find((p) => p.body.id === EARTH_ID);
  const links = linkBySpacecraft(dsn?.links ?? []);
  const hidden = system.bodies.filter((b) => b.kind === "probe").length - probes.length;

  const lines = probes.flatMap((p) => {
    const link = links.get(p.body.id);
    if (!link || !earth) return [];
    const length = Math.hypot(p.at.x - earth.at.x, p.at.y - earth.at.y);
    return length < MIN_LINE ? [] : [{ p, link, length }];
  });

  return (
    <div className="deepspace-stage">
      <div className="deepspace-stage__bar">
        <Segmented<ScaleMode> label="Distance scale" value={mode} options={SCALE_OPTIONS} onChange={setMode} />
        <span className="deepspace-stage__note">
          {mode === "system" ? "Linear to Jupiter, then logarithmic: each ring beyond is a multiple, not a step." : "Linear, out to 2 AU."}
          {hidden > 0 && mode === "inner" ? ` ${hidden} probes lie beyond this view.` : ""}
        </span>
      </div>

      <div className="deepspace-orrery" role="group" aria-label="Top-down map of the Solar System with the spacecraft the Deep Space Network is talking to">
        <svg className="deepspace-orrery__svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          {scale.rings.map((ring) => (
            <circle key={ring.au} className={ring.lightDay ? "deepspace-ring deepspace-ring--lightday" : "deepspace-ring"} cx={CENTER} cy={CENTER} r={scale.radius(ring.au)} />
          ))}
          {planets.map(({ body }) => (
            <circle key={body.id} className="deepspace-orbit" cx={CENTER} cy={CENTER} r={scale.radius(body.distSunKm / AU_KM)} />
          ))}
          {lines.map(({ p, link }, i) =>
            earth ? <line key={link.key} className="deepspace-link" style={{ animationDelay: `${i * 120}ms` }} x1={p.at.x} y1={p.at.y} x2={earth.at.x} y2={earth.at.y} /> : null,
          )}
        </svg>

        <div className="deepspace-orrery__html">
          {scale.rings.map((ring) => (
            <span key={ring.au} className={ring.lightDay ? "deepspace-ringlabel deepspace-ringlabel--lightday" : "deepspace-ringlabel"} style={{ ...pct(CENTER), top: `${((CENTER + scale.radius(ring.au)) / SIZE) * 100}%` }}>
              {ring.label}
            </span>
          ))}

          <span className="deepspace-sun" style={spot({ x: CENTER, y: CENTER, left: 50, top: 50 })} title="The Sun" />

          {planets.map(({ body, at }) => {
            const isEarth = body.id === EARTH_ID;
            const labelled = mode === "inner" || !CROWDED_PLANETS.has(body.id);
            return (
              <span key={body.id} className={`deepspace-planet${isEarth ? " deepspace-planet--earth" : ""}`} style={spot(at)}>
                <span className="deepspace-planet__dot" />
                {labelled && <span className="deepspace-planet__name">{body.name}</span>}
              </span>
            );
          })}

          {lines.map(({ p, link }, i) => (
            <LineLabel key={link.key} from={p.at} to={earth?.at ?? p.at} link={link} body={p.body} index={i} />
          ))}

          {probes.map(({ body, at }, i) => {
            const link = links.get(body.id);
            // A spacecraft on air is already named on its line to Earth.
            const label = link === undefined && (NOTABLE.has(body.id) || selected === body.id);
            return (
              <button
                key={body.id}
                type="button"
                className={`deepspace-probe${link ? " deepspace-probe--live" : ""}${selected === body.id ? " deepspace-probe--selected" : ""}`}
                style={{ ...spot(at), animationDelay: `${i * 40}ms` }}
                aria-label={`${body.name}, ${distanceWords(body.distEarthKm, units)} from Earth${link ? ", on air now" : ""}`}
                onClick={() => openSpacecraft({ naifId: body.id, name: body.name })}
              >
                <span className="deepspace-probe__mark" />
                <span className={`deepspace-probe__name${label ? " deepspace-probe__name--shown" : ""}`}>{body.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The spacecraft's name and the age of the signal, just beyond the spacecraft on the line from Earth, so it never lands in the crowded middle. */
function LineLabel({ from, to, link, body, index }: { from: Placed; to: Placed; link: DsnLink; body: SystemBody; index: number }): ReactElement {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  const len = Math.hypot(dx, dy) || 1;
  const x = from.x + (dx / len) * 20;
  const y = from.y + (dy / len) * 20;
  const side = dx >= 0 ? "right" : "left";
  const seconds = link.lightSeconds ?? body.lightSeconds;
  return (
    <span className={`deepspace-linklabel deepspace-linklabel--${side}`} style={{ left: `${(x / SIZE) * 100}%`, top: `${(y / SIZE) * 100}%`, animationDelay: `${index * 120 + 300}ms` }}>
      <span className="deepspace-linklabel__name">{body.name}</span>
      <span className="deepspace-linklabel__time num">{signalLeftWords(seconds)}</span>
    </span>
  );
}

function OnAirRow({ link, body, dsn }: { link: DsnLink; body: SystemBody | undefined; dsn: DsnSnapshot }): ReactElement {
  const units = useSettings((s) => s.units);
  const complex = dsn.complexes.find((c) => c.id === link.complexId);
  const seconds = link.lightSeconds ?? body?.lightSeconds ?? null;
  return (
    <li>
      <button type="button" className="deepspace-row" onClick={() => openSpacecraft(link.spacecraft)}>
        <LiveDot tone="sodium" />
        <span className="deepspace-row__main">
          <span className="deepspace-row__name">{link.spacecraft.name}</span>
          <span className="deepspace-row__sub">
            {complex?.name ?? link.complexId} · {link.dishIds.map((d) => d.replace(/^([A-Za-z]+)(\d+)$/, "$1 $2")).join(", ")}
          </span>
        </span>
        <span className="deepspace-row__figures num">
          <span>{link.distanceKm === null ? "range unknown" : distanceWords(link.distanceKm, units)}</span>
          {seconds !== null && <span className="deepspace-row__dim">{signalLeftWords(seconds)}</span>}
        </span>
      </button>
    </li>
  );
}

function ProbeRow({ body }: { body: SystemBody }): ReactElement {
  const units = useSettings((s) => s.units);
  return (
    <li>
      <button type="button" className="deepspace-row" onClick={() => openSpacecraft({ naifId: body.id, name: body.name })}>
        <span className="deepspace-row__main">
          <span className="deepspace-row__name">{body.name}</span>
        </span>
        <span className="deepspace-row__figures num">
          <span>{distanceWords(body.distEarthKm, units)}</span>
          <span className="deepspace-row__dim">{lightTimeWords(body.lightSeconds)} one way</span>
        </span>
      </button>
    </li>
  );
}

/** The solar system view: the orrery, who is on air, and every probe the screen knows about. */
export function OrreryView({ system, systemError, dsn }: { system: SystemSnapshot | undefined; systemError: Error | null; dsn: DsnSnapshot | undefined }): ReactElement {
  if (!system) {
    return systemError ? (
      <Empty title="No positions from JPL Horizons" tone="error">
        {systemError.message} The screen retries by itself.
      </Empty>
    ) : (
      <Scanning label="Asking JPL Horizons where everything is" />
    );
  }
  const hasEarth = system.bodies.some((b) => b.id === EARTH_ID);
  if (!hasEarth) return <Scanning label="Asking JPL Horizons where Earth is" />;

  const links = linkBySpacecraft(dsn?.links ?? []);
  const byId = new Map(system.bodies.map((b) => [b.id, b]));
  const onAir = [...(dsn?.links ?? [])].sort((a, b) => (b.distanceKm ?? 0) - (a.distanceKm ?? 0));
  const others = system.bodies.filter((b) => b.kind === "probe" && !links.has(b.id)).sort((a, b) => b.distEarthKm - a.distEarthKm);
  const total = system.bodies.length + system.pending + system.unavailable.length;

  return (
    <div className="deepspace-solar">
      <Panel title="Solar System from above" flush className="deepspace-solar__map">
        <div className="deepspace-solar__pad">
          <Stage system={system} dsn={dsn} />
          {system.pending > 0 && (
            <div className="deepspace-solar__loading">
              <Scanning label={`Asking JPL Horizons · ${system.bodies.length} of ${total}`} />
            </div>
          )}
        </div>
      </Panel>
      <div className="deepspace-solar__side">
        <Panel title={`On air now · ${onAir.length}`}>
          {dsn ? (
            onAir.length > 0 ? (
              <ul className="deepspace-rows">
                {onAir.map((link) => (
                  <OnAirRow key={link.key} link={link} body={byId.get(link.spacecraft.naifId)} dsn={dsn} />
                ))}
              </ul>
            ) : (
              <Empty title="No dish has a signal">The network is quiet at this moment. This list fills as soon as a pass begins.</Empty>
            )
          ) : (
            <Scanning label="Reading the network" />
          )}
        </Panel>
        <Panel title={`Other probes · ${others.length}`}>
          <ul className="deepspace-rows">
            {others.map((b) => (
              <ProbeRow key={b.id} body={b} />
            ))}
          </ul>
          {system.unavailable.length > 0 && (
            <p className="deepspace-fine">
              No trajectory from JPL for {system.unavailable.map((u) => u.name).join(", ")}.
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}
