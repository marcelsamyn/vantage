import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { usePlaceFact } from "./client";
import { FactState } from "./FactSection";

const FUEL_LABEL = { gas: "Gas", electricity: "Electricity" } as const;

/** Street energy use in Flanders: what an average connection on this street used, against its municipality. */
export default function EnergyFact({ entity }: ProfilerSectionProps<"place">): ReactElement | null {
  const poll = usePlaceFact("energy", entity.data);
  return (
    <FactState poll={poll} title="Street energy use" source={() => "Fluvius open data · average per connection, homes and businesses"}>
      {(energy) => (
        <>
          <p className="dossier-item__meta">
            {energy.street}, {energy.municipality} · {energy.year}
          </p>
          <ul className="dossier-list">
            {energy.fuels.map((f) => {
              const top = Math.max(f.streetKwh, f.municipalityKwh);
              const diff = Math.round((f.streetKwh / f.municipalityKwh - 1) * 100);
              return (
                <li key={f.fuel} className="dossier-item">
                  <div className="dossier-energy__row">
                    <span>{FUEL_LABEL[f.fuel]}</span>
                    <span className="num">
                      {fmt.int(f.streetKwh)} kWh <span className="dossier-energy__diff">{Math.abs(diff) < 3 ? "≈ average" : `${diff > 0 ? "+" : "−"}${Math.abs(diff)} %`}</span>
                    </span>
                  </div>
                  <div className="dossier-energy__track" role="img" aria-label={`${FUEL_LABEL[f.fuel]}: this street ${fmt.int(f.streetKwh)} kWh, ${energy.municipality} ${fmt.int(f.municipalityKwh)} kWh`}>
                    <div className="dossier-energy__fill" style={{ width: `${(f.streetKwh / top) * 100}%` }} />
                    <div className="dossier-energy__mark" style={{ left: `${(f.municipalityKwh / top) * 100}%` }} />
                  </div>
                  <div className="dossier-item__meta">
                    {energy.municipality} average {fmt.int(f.municipalityKwh)} kWh · {fmt.int(f.connections)} connections here
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </FactState>
  );
}
