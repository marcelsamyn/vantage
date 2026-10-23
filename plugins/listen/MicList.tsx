import { motion } from "motion/react";
import { useMemo, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { Here } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { distanceM } from "../../shared/geo";
import { DaylightIcon } from "./Daylight";
import { usePlayer } from "./audio";
import { clockAt, daylightAt } from "./sun";
import type { Microphone } from "./types";

/** Every microphone as a list, nearest first when your location is known. The list works when the map cannot load. */
export function MicList({ mics, here, onChoose }: { mics: readonly Microphone[]; here: Here | null; onChoose: (mic: Microphone) => void }): ReactElement {
  const selected = usePlayer((s) => s.mic?.id ?? null);
  const units = useSettings((s) => s.units);
  const now = useNow(30_000);

  const rows = useMemo(() => {
    const withDistance = mics.map((mic) => ({ mic, away: here ? distanceM(here, mic) : null }));
    return withDistance.sort((a, b) => (a.away !== null && b.away !== null ? a.away - b.away : a.mic.place.localeCompare(b.mic.place)));
  }, [mics, here]);

  return (
    <ul className="listen-list">
      {rows.map(({ mic, away }, i) => {
        const at = new Date(now);
        const daylight = daylightAt(mic.lat, mic.lon, at);
        const clock = clockAt(mic.timezone, mic.lon, at);
        return (
          <motion.li key={mic.id} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 12) * 0.03, type: "spring", duration: 0.4, bounce: 0 }}>
            <button type="button" className="v-row listen-row" aria-current={mic.id === selected ? "true" : undefined} onClick={() => onChoose(mic)}>
              <span className={`listen-row__sun listen-row__sun--${daylight}`}>
                <DaylightIcon daylight={daylight} size={13} />
              </span>
              <span className="v-row__main">
                <span className="v-row__title">{mic.format === "hls" ? mic.place : `${mic.place} · ${mic.name}`}</span>
                <span className="v-row__sub">
                  {[mic.format === "hls" ? "Hydrophone" : mic.country, clock.text, away !== null ? fmt.distance(away, units) : null].filter(Boolean).join(" · ")}
                  {!mic.live && " · offline"}
                </span>
              </span>
            </button>
          </motion.li>
        );
      })}
    </ul>
  );
}
