import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard, Tag } from "../../app/ui";
import type { NoteComment } from "./types";

const ACTION: Record<NoteComment["action"], string> = { opened: "opened it", commented: "commented", closed: "closed it", reopened: "reopened it", hidden: "hid it" };

/** Profile of one OpenStreetMap note. The people in the discussion are all "a mapper": names are removed on the server. */
export default function NoteProfile({ entity, onClose }: ProfilerProps<"mapnote">): ReactElement {
  const n = entity.data;
  return (
    <ProfilerCard
      key={n.id}
      band={n.status === "open" ? "Map note · open" : "Map note · closed"}
      name={`Note ${n.id}`}
      kicker="OpenStreetMap"
      onClose={onClose}
      rows={[
        ["Left", fmt.ago(n.createdAt)],
        ["Position", fmt.coord(n.lat, n.lon)],
        ["Messages", String(n.comments.length)],
      ]}
      fact="Mappers read these notes to fix the map."
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={n.url} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={13} /> On OpenStreetMap
        </a>
      }
      source="OpenStreetMap contributors (ODbL)"
    >
      <ol className="reach-thread">
        {n.comments.map((c, i) => (
          <li key={i} className="reach-thread__item">
            <div className="reach-thread__who">
              <span className="v-eyebrow">A mapper {ACTION[c.action]}</span>
              <Tag>{fmt.ago(c.at)}</Tag>
            </div>
            {c.text && <p className="reach-thread__text">{c.text}</p>}
          </li>
        ))}
      </ol>
    </ProfilerCard>
  );
}
