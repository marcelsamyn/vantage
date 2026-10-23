import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Tag } from "../../app/ui";
import { usePlaceFact } from "./client";
import { FactState, Meta } from "./FactSection";

/** "1,20 euro/h" becomes "€1.20 per hour". */
const price = (tariff: string): string => tariff.replace(/^(\d+)[,.](\d+)\s*euro\/h$/i, "€$1.$2 per hour").replace(/^(\d+)\s*euro\/h$/i, "€$1 per hour");

/** The city's files write the accent of Italian weekdays as an apostrophe ("Lunedi'"). */
const accent = (text: string): string => text.replace(/di'/g, "dì");

/** A meter's tariff reads "ZONA 01 - 1.00 euro/h - 08:00 19:00 - Lunedi' - Sabato"; split it into parts, or show it as written when it has another shape. */
function meterTerms(tariff: string): string[] {
  const m = /^ZONA\s*(\d+)\s*-\s*(\d+)[.,](\d+)\s*euro\/h(\s*ZTL)?\s*-\s*(\d\d:\d\d)\s+(\d\d:\d\d)\s*-\s*(.+)$/i.exec(tariff);
  if (!m) return [accent(tariff)];
  const [, zone, euros, cents, ztl, from, to, days] = m;
  return [`€${euros}.${cents} per hour`, `${from}–${to}`, accent(days ?? "").replace(/\s+-\s+/, "–"), `zone ${zone}${ztl ? " (ZTL)" : ""}`];
}

/** Rome's pay-parking: the blue-line tariff on this street and the nearest meters. */
export default function ParkingFact({ entity }: ProfilerSectionProps<"place">): ReactElement | null {
  const units = useSettings((s) => s.units);
  const poll = usePlaceFact("parking", entity.data);
  return (
    <FactState poll={poll} title="Pay-parking" source={(p) => `Roma Capitale open data · file of ${p.asOf}`}>
      {(parking) => {
        if (!parking.segment && parking.meters.length === 0) return null;
        const s = parking.segment;
        return (
          <>
            {s && (
              <div className="dossier-item">
                <div className="dossier-item__title">
                  {s.street} <Tag tone="ice">Blue line</Tag>
                </div>
                <Meta parts={[price(s.tariff), `${s.from}–${s.to}`, accent(s.days).replace(/\s+-\s+/, "–")]} />
              </div>
            )}
            {parking.meters.length > 0 && (
              <ul className="dossier-list">
                {parking.meters.map((m, i) => (
                  <li key={`${m.address}-${i}`} className="dossier-item">
                    <div className="dossier-item__title">
                      Meter · {m.address}
                      {m.detail ? `, ${m.detail.toLowerCase()}` : ""}
                    </div>
                    <Meta parts={[fmt.distance(m.distanceM, units), ...meterTerms(m.tariff)]} />
                  </li>
                ))}
              </ul>
            )}
          </>
        );
      }}
    </FactState>
  );
}
