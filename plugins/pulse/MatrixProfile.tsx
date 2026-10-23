import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard } from "../../app/ui";
import { displayLook, explainDisplay, gantryLook } from "./matrix";
import "./pulse.css";

/** One gantry over a Dutch motorway: what each lane's sign shows and what that means. */
export default function MatrixProfile({ entity, onClose }: ProfilerProps<"matrixgantry">): ReactElement {
  const g = entity.data.gantry;
  const now = useNow(30_000);
  const look = gantryLook(g);
  const tone = look.css === "var(--alarm)" ? "alarm" : look.css === "var(--mint)" ? "mint" : "sodium";

  return (
    <ProfilerCard
      band="Motorway signs · live"
      tone={tone}
      name={`${g.road} · km ${g.km.toFixed(1)}`}
      kicker={`${g.lanes.length} lane ${g.lanes.length === 1 ? "sign" : "signs"} lit`}
      onClose={onClose}
      rows={[["Position", fmt.coord(g.lat, g.lon)]]}
      fact="NDW publishes what every lane sign shows. Most are blank; only the ones with something to say are listed here."
      source="NDW open data (CC0) · matrix signal information"
    >
      <ul className="pulse-lanes">
        {g.lanes.map((l) => {
          const lane = displayLook(l.display);
          const text = explainDisplay(l.display);
          return (
            <li key={l.lane} className="pulse-lane">
              <span className="pulse-lane__mark num" style={{ color: lane.css, borderColor: lane.css }}>
                {lane.label}
              </span>
              <span className="pulse-lane__title">
                Lane {l.lane}: {text.title}
              </span>
              <span className="pulse-lane__since num">since {fmt.ago(l.since, now)}</span>
              <span className="pulse-lane__note">{text.note}</span>
            </li>
          );
        })}
      </ul>
    </ProfilerCard>
  );
}
