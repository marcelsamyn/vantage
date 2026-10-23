import { CalendarPlus } from "lucide-react";
import { useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Empty, LiveDot, ProfilerCard, Scanning, Tag } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { fetchStation, useStations } from "./client";
import { stationPage, type GroundStation, type Observation, type StationDetail } from "./types";

/** Profile of one SatNOGS ground station: what it heard lately, what it will hear next, and a link to book a pass. */
export default function StationProfile({ entity, onClose }: ProfilerProps<"groundstation">): ReactElement {
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const now = useNow(30_000);
  const live = useStations().data?.stations.find((s) => s.id === entity.data.id);
  const s: GroundStation = live ?? entity.data;
  const detail = usePoll((signal) => fetchStation(s.id, signal), 60_000, [s.id]);
  const recording = s.observing !== null && s.observing.endsAt > now;

  return (
    <ProfilerCard
      key={s.id}
      band={recording ? "Ground station · recording" : s.status === "online" ? "Ground station · online" : "Ground station · testing"}
      tone={recording ? "sodium" : s.status === "online" ? "mint" : "ice"}
      name={s.name}
      kicker={s.antennas.join(" + ") || "Satellite ground station"}
      onClose={onClose}
      rows={[
        recording && s.observing && ["Recording", `${s.observing.satellite}, ends ${fmt.until(s.observing.endsAt, now)}`],
        here && ["From you", `${fmt.distance(distanceM(here, s), units)} ${compassPoint(bearingDeg(here, s))}`],
        ["Position", `${fmt.coord(s.lat, s.lon)} · ${fmt.int(s.altitudeM)} m`],
        ["Observations", `${fmt.int(s.observations)}${s.successRate !== null ? ` · ${s.successRate}% good` : ""}`],
        ["Scheduled", `${fmt.int(s.scheduled)} ahead`],
        ["Last heard from", s.lastSeen ? fmt.ago(s.lastSeen, now) : "never"],
        s.owner && ["Operator", s.owner],
      ]}
      fact="The recordings come from volunteers' antennas, so you can listen to a satellite pass over a country you have never visited."
      actions={
        <>
          <a className="v-btn v-btn--sm v-btn--primary" href={stationPage(s.id)} target="_blank" rel="noreferrer noopener" title="Scheduling needs a free SatNOGS account, which you create on their site">
            <CalendarPlus size={13} /> Schedule a pass on this station
          </a>
        </>
      }
      source="SatNOGS Network (CC BY-SA)"
    >
      <Passes detail={detail.data} loading={detail.loading} error={detail.error?.message ?? null} now={now} />
    </ProfilerCard>
  );
}

function Passes({ detail, loading, error, now }: { detail: StationDetail | undefined; loading: boolean; error: string | null; now: number }): ReactElement {
  const [picked, setPicked] = useState<number | null>(null);
  const recent = detail?.recent ?? [];
  // The newest recording is open at first; a choice that has left the list falls back to it.
  const chosen = recent.find((o) => o.id === picked) ?? recent[0] ?? null;

  if (!detail) return error ? <Empty title="Could not load this station's passes" tone="error">{error}</Empty> : loading ? <Scanning label="Loading passes" /> : <></>;

  return (
    <div className="reach-passes">
      <div className="v-eyebrow">Latest good recordings</div>
      {recent.length === 0 ? (
        <p className="reach-passes__none">This station has no recording marked good yet. Check the station page for its newest passes.</p>
      ) : (
        <>
          <ul className="reach-obs">
            {recent.map((o) => (
              <li key={o.id}>
                <button type="button" className="reach-obs__row" aria-pressed={chosen?.id === o.id} onClick={() => setPicked(o.id)}>
                  <span className="reach-obs__sat">{o.satellite}</span>
                  <span className="reach-obs__meta">{fmt.ago(o.startsAt, now)}</span>
                  {o.decodedFrames > 0 && <Tag tone="mint">{o.decodedFrames} decoded</Tag>}
                </button>
              </li>
            ))}
          </ul>
          {chosen && <Recording o={chosen} />}
        </>
      )}
      <div className="v-eyebrow reach-passes__gap">Next 4 hours</div>
      {detail.upcoming.length === 0 ? (
        <p className="reach-passes__none">Nothing is scheduled for the next four hours.</p>
      ) : (
        <ul className="reach-obs">
          {detail.upcoming.map((o) => (
            <li key={o.id} className="reach-obs__row reach-obs__row--plain">
              <span className="reach-obs__sat">
                {o.startsAt <= now && <LiveDot tone="sodium" />} {o.satellite}
              </span>
              <span className="reach-obs__meta">{o.startsAt <= now ? "recording" : fmt.until(o.startsAt, now)}</span>
              {o.maxElevationDeg !== null && <span className="reach-obs__meta">{Math.round(o.maxElevationDeg)}° up</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The waterfall (signal strength over time) and the audio of one pass. Both load only for the recording you pick. */
function Recording({ o }: { o: Observation }): ReactElement {
  return (
    <figure className="reach-rec" key={o.id}>
      {o.waterfall ? <img className="reach-rec__water" src={o.waterfall} alt={`Waterfall of ${o.satellite}: signal strength over the pass, time running downward`} loading="lazy" referrerPolicy="no-referrer" /> : <p className="reach-passes__none">No waterfall image for this pass.</p>}
      {o.audio ? <audio className="reach-rec__audio" controls preload="none" src={o.audio} /> : <p className="reach-passes__none">No audio was kept for this pass.</p>}
      <figcaption className="reach-rec__cap">
        {[o.mode, o.frequencyMhz !== null ? `${o.frequencyMhz.toFixed(3)} MHz` : null, o.maxElevationDeg !== null ? `${Math.round(o.maxElevationDeg)}° peak` : null].filter(Boolean).join(" · ")}
        {" · "}
        <a href={o.page} target="_blank" rel="noreferrer noopener">
          Open on SatNOGS
        </a>
      </figcaption>
    </figure>
  );
}
