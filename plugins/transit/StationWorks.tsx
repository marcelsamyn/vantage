import { Map as MapIcon } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { profile } from "../../app/core/profile";
import { Button, Tag } from "../../app/ui";
import { showLayer } from "../city/client";
import { fetchWorksNear, trackWords, workDates, workHours, workTitle } from "./client";
import "./transit.css";

const SHOWN = 3;

/**
 * Planned works on the track next to a Belgian station. It stays silent elsewhere, and where Infrabel lists
 * nothing near the station, so the profile grows only when there is something a traveller should know.
 */
export default function StationWorks({ entity }: ProfilerSectionProps<"stop">): ReactElement | null {
  const { lat, lon } = entity.data;
  const { data, error } = usePoll((signal) => fetchWorksNear({ lat, lon }, signal), 30 * 60_000, [lat, lon]);

  if (!data) {
    return error ? (
      <section className="transit-works">
        <h4 className="v-eyebrow">Rail works near this station</h4>
        <p className="transit-works__note">Infrabel's works list did not answer: {error.message}</p>
      </section>
    ) : null;
  }
  if (data.length === 0) return null;

  return (
    <section className="transit-works">
      <h4 className="v-eyebrow">Rail works near this station</h4>
      <ul className="transit-works__list">
        {data.slice(0, SHOWN).map(({ work, distanceM }) => (
          <li key={work.id}>
            <button type="button" className="transit-works__item" onClick={() => profile.open({ kind: "railwork", id: work.id, data: work })}>
              <span className="transit-works__head">
                <span className="transit-works__title">{workTitle(work)}</span>
                <Tag tone={work.impact === "Major" ? "alarm" : "sodium"}>{work.impact === "Major" ? "Major" : "Minor"}</Tag>
              </span>
              <span className="transit-works__meta">
                {[work.effect, trackWords(work.tracks), workHours(work), `${work.started ? "until" : "from"} ${work.started ? workDates({ first: work.last, last: work.last }) : workDates({ first: work.first, last: work.first })}`, distanceM < 50 ? "at the station" : `${fmt.int(distanceM)} m away`]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {data.length > SHOWN && <p className="transit-works__note">and {data.length - SHOWN} more nearby.</p>}
      <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("transit.works")}>
        Show rail works on the map
      </Button>
      <div className="transit-works__source">Infrabel open data · long-term plan of temporary capacity restrictions · CC0</div>
    </section>
  );
}
