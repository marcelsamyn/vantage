import type { ReactElement } from "react";
import { useLocation } from "../../app/core/location";
import { Empty, Scanning, Stat } from "../../app/ui";
import { useCityTenders } from "./client";
import { biggest, money } from "./tender-format";
import "./dossier.css";

const SHOWN = 3;

/** Briefing tile: how many public contracts the city's authorities put out this month, and the biggest of the newest. */
export default function TendersTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const { data, error } = useCityTenders(here);

  if (!here) return status === "locating" ? <Scanning label="Locating" /> : <Empty title="Location unknown">Allow location or pin a place from the command palette, and this tile will look up what your city is buying.</Empty>;
  if (error && !data) return <Empty title="TED did not answer" tone="error">{error.message}. This tile tries again in a few minutes.</Empty>;
  if (data === undefined) return <Scanning label="Reading public tenders" />;
  if (data === null || data.total === 0) {
    return <Empty title="No tenders found for this city">TED lists contract notices by the city where the buyer is based. Nothing was published there in the last 30 days, or the buyers write the city name another way.</Empty>;
  }

  const top = biggest(data.tenders, SHOWN);
  const peak = Math.max(1, ...top.map((t) => t.value ?? 0));
  return (
    <div className="dossier-buying">
      <Stat label={`${data.city} · last ${data.sinceDays} days`} value={data.total} unit="tenders" size="lg" tone="sodium" hint={`Contract notices published by buyers based in ${data.city}`} />
      <ul className="dossier-buying__list">
        {top.map((t) => (
          <li key={t.id}>
            <a className="dossier-buying__row" href={t.url} target="_blank" rel="noreferrer">
              <span className="dossier-buying__buyer">{t.buyer}</span>
              <span className="num dossier-buying__sum">{t.value === null ? "" : money(t.value, t.currency)}</span>
              <span className="dossier-buying__bar" aria-hidden>
                <span className="dossier-buying__fill" style={{ width: `${Math.max(3, ((t.value ?? 0) / peak) * 100)}%` }} />
              </span>
              <span className="dossier-buying__what">{t.category ?? t.title}</span>
            </a>
          </li>
        ))}
      </ul>
      <div className="dossier-know__source">Largest of the newest {data.tenders.length} · EU TED</div>
    </div>
  );
}
