import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { Meta } from "./FactSection";
import { deadlineWords, money } from "./tender-format";
import type { Tender } from "./types";

/** Today in the time zone Rome and Brussels share, as an ISO date: the day a deadline is counted from. */
export const today = (): string => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Brussels" });

/**
 * Contract notices as a short list: the title opens the notice on TED, a bar beside the value shows its size
 * against the biggest in the list. Buyers are organisations; the list carries no contact details.
 */
export function TenderList({ tenders }: { tenders: readonly Tender[] }): ReactElement {
  const peak = Math.max(1, ...tenders.map((t) => t.value ?? 0));
  const day = today();
  return (
    <ul className="dossier-list">
      {tenders.map((t) => (
        <li key={t.id} className="dossier-item dossier-tender">
          <a className="dossier-item__title dossier-tender__title" href={t.url} target="_blank" rel="noreferrer">
            {t.title}
            <ExternalLink size={11} aria-label="Notice on TED" />
          </a>
          <div className="dossier-tender__buyer">{t.buyer}</div>
          {t.value !== null && (
            <div className="dossier-tender__value">
              <span className="dossier-tender__bar" aria-hidden>
                <span className="dossier-tender__fill" style={{ width: `${Math.max(3, (t.value / peak) * 100)}%` }} />
              </span>
              <span className="num dossier-tender__sum">{money(t.value, t.currency)}</span>
            </div>
          )}
          <Meta parts={[t.category, deadlineWords(t.deadline, day)]} />
        </li>
      ))}
    </ul>
  );
}
