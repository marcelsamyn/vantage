import { useState, type ReactElement } from "react";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { Button } from "../../app/ui";
import { useCityTenders } from "./client";
import { FactState } from "./FactSection";
import { TenderList } from "./TenderList";

const FIRST = 4;
const MORE = 12;

/** What the public authorities of the city around this spot are buying: contract notices from the last 30 days. */
export default function TendersFact({ entity }: ProfilerSectionProps<"place">): ReactElement | null {
  const poll = useCityTenders(entity.data);
  const [open, setOpen] = useState(false);
  return (
    <FactState poll={poll} title="What the city is buying" source={() => "EU TED · contract notices, last 30 days · buyers named are organisations"}>
      {(t) =>
        t.tenders.length === 0 ? null : (
          <>
            <p className="dossier-tender__count">
              <span className="num dossier-tender__n">{t.total}</span> contract {t.total === 1 ? "notice" : "notices"} from buyers based in {t.city} in {t.sinceDays} days. The newest:
            </p>
            <TenderList tenders={t.tenders.slice(0, open ? MORE : FIRST)} />
            {t.tenders.length > FIRST && (
              <Button size="sm" onClick={() => setOpen(!open)}>
                {open ? "Show fewer" : `Show ${Math.min(MORE, t.tenders.length) - FIRST} more`}
              </Button>
            )}
          </>
        )
      }
    </FactState>
  );
}
