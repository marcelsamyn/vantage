import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard, Tag } from "../../app/ui";
import { trackWords, workDates, workHours, workTitle } from "./client";
import "./transit.css";

const DAY_MS = 86_400_000;

/** Profiler for a planned track restriction on the Belgian network. */
export default function RailProfile({ entity, onClose }: ProfilerProps<"railwork">): ReactElement {
  const w = entity.data;
  const days = Math.ceil((Date.parse(`${w.first}T00:00:00Z`) - Date.now()) / DAY_MS);
  const hours = workHours(w);
  return (
    <ProfilerCard
      band="Rail works · Infrabel"
      tone={w.impact === "Major" ? "alarm" : "sodium"}
      name={workTitle(w)}
      kicker={w.effect}
      onClose={onClose}
      rows={[
        ["Impact", <Tag key="i" tone={w.impact === "Major" ? "alarm" : "sodium"}>{w.impact === "Major" ? "Major impact" : "Minor impact"}</Tag>],
        ["Now", w.started ? "In force today" : `Starts in ${fmt.int(Math.max(1, days))} ${days <= 1 ? "day" : "days"}`],
        ["Dates", workDates(w)],
        hours && ["Hours", hours],
        ["Tracks", trackWords(w.tracks)],
        w.start && w.end && w.start !== w.end && ["Between", `${w.start} and ${w.end}`],
      ]}
      fact="Infrabel files its restrictions up to two years ahead, so this card can show works that have not started yet."
      source="Infrabel open data · long-term plan of temporary capacity restrictions · CC0"
    />
  );
}
