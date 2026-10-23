import { motion } from "motion/react";
import { Play, Square } from "lucide-react";
import { useEffect, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, useStoredState } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { Button, Empty, IconButton, Meter, Panel, Scanning, Segmented } from "../../app/ui";
import { stopClip, playClip, useClip } from "./clip";
import { useBirds } from "./client";
import type { BirdSpecies, BirdWindow } from "./types";

const WINDOWS = [
  { value: "hour", label: "Last hour" },
  { value: "day", label: "24 hours" },
] as const satisfies readonly { value: BirdWindow; label: string }[];

/** Singing near you: species heard around your place, how sure the detector was, and a recording to play. */
export function Birds(): ReactElement {
  const here = useLocation((s) => s.here);
  const [span, setSpan] = useStoredState<BirdWindow>("listen.birds.window", "hour");
  const clipError = useClip((s) => s.error);
  const { data, error, refresh } = useBirds(here, span);
  useEffect(() => stopClip, []);

  const body = ((): ReactElement => {
    if (!here) return <Empty title="Your location is needed">Birds are listed for the 55 km around you. Allow location access, or pin a place on the City map.</Empty>;
    if (error && !data) {
      return (
        <Empty title="Birdsong unavailable" tone="error" action={<Button onClick={refresh}>Try again</Button>}>
          {error.message}
        </Empty>
      );
    }
    if (!data) return <Scanning label="Listening for birds" />;
    if (data.detections === 0) {
      return (
        <Empty title={span === "hour" ? "Quiet around you" : "No birds recorded"} action={span === "hour" ? <Button onClick={() => setSpan("day")}>Show the last 24 hours</Button> : undefined}>
          {span === "hour" ? "BirdWeather stations within about 28 km heard no birds in the last hour. Most songbirds are silent at night." : "BirdWeather has no station reporting within about 28 km of you. The nearest ones may be further away."}
        </Empty>
      );
    }
    return (
      <>
        <p className="listen-birds__scope">
          <span className="num listen-birds__figure">{fmt.int(data.detections)}</span> calls from <span className="num listen-birds__figure">{data.species}</span> species, heard by <span className="num listen-birds__figure">{data.stations}</span> listening {data.stations === 1 ? "station" : "stations"} within about {data.area.radiusKm} km.
        </p>
        <ul className="listen-birds__list">
          {data.top.map((s, i) => (
            <Species key={s.id} species={s} rank={i} top={data.top[0]?.count ?? 1} />
          ))}
        </ul>
        <Rhythm hours={data.hours} />
      </>
    );
  })();

  return (
    <Panel title="Singing near you" className="listen-birds" actions={<Segmented label="Time window" value={span} options={WINDOWS} onChange={setSpan} />}>
      {body}
      {clipError && <p className="listen-footnote alarm">{clipError}</p>}
      <p className="listen-footnote">Species are recognised by BirdNET on small stations run through BirdWeather.</p>
    </Panel>
  );
}

function Species({ species, rank, top }: { species: BirdSpecies; rank: number; top: number }): ReactElement {
  const playing = useClip((s) => s.playing === species.id);
  return (
    <motion.li className="listen-species" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: rank * 0.05, type: "spring", duration: 0.45, bounce: 0 }}>
      <IconButton
        label={species.clip ? (playing ? `Stop the ${species.commonName} recording` : `Play a recording of a ${species.commonName}`) : "No public recording for this species right now"}
        on={playing}
        disabled={!species.clip}
        onClick={() => species.clip && playClip(species.id, species.clip)}
      >
        {playing ? <Square size={13} fill="currentColor" /> : <Play size={14} />}
      </IconButton>
      <div className="listen-species__text">
        <div className="listen-species__name">{species.commonName}</div>
        <div className="listen-species__latin">{species.scientificName}</div>
        <div className="listen-species__sure">
          <Meter value={species.certainty ?? 0} tone="sodium" />
          <span className="num dim">{species.certainty === null ? "—" : `${Math.round(species.certainty * 100)}% sure`}</span>
        </div>
      </div>
      <div className="listen-species__count display num" style={{ opacity: 0.55 + 0.45 * (species.count / top) }}>
        {fmt.int(species.count)}
      </div>
      {playing && species.clip && <div className="listen-species__heard dim">Heard {fmt.ago(species.clip.at)} in your area</div>}
    </motion.li>
  );
}

/** Calls per hour of the day over the last 24 hours: the dawn chorus, and who is awake at night. */
function Rhythm({ hours }: { hours: readonly number[] }): ReactElement {
  const now = useNow(60_000);
  const current = new Date(now).getHours();
  const peak = Math.max(1, ...hours);
  return (
    <figure className="listen-rhythm">
      <figcaption className="v-eyebrow">Calls by hour of day · last 24 h</figcaption>
      <svg viewBox="0 0 240 50" preserveAspectRatio="none" role="img" aria-label="Bar chart of bird calls for each hour of the day">
        {hours.map((count, h) => {
          const height = count === 0 ? 1 : Math.max(2, (count / peak) * 48);
          return (
            <motion.rect
              key={h}
              x={h * 10 + 1}
              width={8}
              y={50 - height}
              height={height}
              className={h === current ? "listen-rhythm__bar listen-rhythm__bar--now" : "listen-rhythm__bar"}
              style={{ transformOrigin: "bottom", transformBox: "fill-box" }}
              initial={{ scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: h * 0.012, type: "spring", duration: 0.5, bounce: 0 }}
            >
              <title>{`${String(h).padStart(2, "0")}:00 · ${count} ${count === 1 ? "call" : "calls"}`}</title>
            </motion.rect>
          );
        })}
      </svg>
      <div className="listen-rhythm__axis" aria-hidden>
        {["00", "06", "12", "18", "24"].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </figure>
  );
}
