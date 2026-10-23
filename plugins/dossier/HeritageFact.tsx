import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { usePlaceFact } from "./client";
import { FactState, Meta } from "./FactSection";

/** The nearest catalogued heritage entries: Italy's ArCo, Flanders' inventory, Brussels' Grand-Place file. */
export default function HeritageFact({ entity }: ProfilerSectionProps<"place">): ReactElement | null {
  const units = useSettings((s) => s.units);
  const poll = usePlaceFact("heritage", entity.data);
  return (
    <FactState poll={poll} title="Heritage record" source={(h) => h.source}>
      {(heritage) =>
        heritage.entries.length === 0 ? null : (
          <ul className="dossier-list">
            {heritage.entries.map((e) => (
              <li key={e.id} className="dossier-item">
                <a className="dossier-item__title" href={e.url} target="_blank" rel="noreferrer">
                  {e.title}
                  <ExternalLink size={11} aria-label="Official record" />
                </a>
                <Meta parts={[e.kind, e.period, e.author, e.distanceM === 0 ? "here" : fmt.distance(e.distanceM, units)]} />
                {e.note && <p className="dossier-item__note">{e.note}</p>}
              </li>
            ))}
          </ul>
        )
      }
    </FactState>
  );
}
