import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard, Sparkline } from "../../app/ui";
import { entsogCredit, gasWords } from "./client";
import "./power.css";

/** Profiler for a gas terminal or border pipeline: the flow now and the last two days. */
export default function GasProfile({ entity, onClose }: ProfilerProps<"gaspoint">): ReactElement {
  const s = entity.data;
  const flowing = Math.abs(s.gwh) >= 0.005;
  const values = s.series.map((p) => Math.abs(p.gwh));
  const peak = Math.max(0, ...values);
  const top = s.series.reduce((best, p) => (Math.abs(p.gwh) > Math.abs(best.gwh) ? p : best), s.series[0] ?? { t: s.at, gwh: 0 });
  const country = s.country === "IT" ? "Italy" : "Belgium";
  return (
    <ProfilerCard
      band={s.kind === "lng" ? "Gas · LNG terminal" : "Gas · border pipeline"}
      tone="sodium"
      name={s.name}
      kicker={`Into ${country}`}
      onClose={onClose}
      rows={[
        ["Flow now", flowing ? `${s.gwh < 0 ? "Out of " : "Into "}${country}: ${gasWords(s.gwh)}` : "No flow this hour"],
        ["Comes from", s.origin],
        peak > 0 && ["Peak in this window", `${gasWords(top.gwh)} at ${fmt.clock(top.t * 1000)}`],
        ["Hour shown", `${fmt.clock(s.at * 1000)}, ${fmt.ago(s.at * 1000)}`],
      ]}
      fact="One gigawatt hour of gas is about 90,000 cubic metres, at roughly 11 kilowatt hours of energy in each cubic metre."
      source={entsogCredit("Physical Flow")}
    >
      {s.series.length > 1 && (
        <div className="power-profile__chart" role="img" aria-label={`Hourly gas flow at ${s.name} over the last two days`}>
          <Sparkline values={values} tone={s.gwh >= 0 ? "sodium" : "ice"} height={56} width={300} min={0} />
          <div className="power-profile__axis">
            <span>{Math.round((s.at - (s.series[0]?.t ?? s.at)) / 3600)} h earlier</span>
            <span>newest hour</span>
          </div>
        </div>
      )}
    </ProfilerCard>
  );
}
