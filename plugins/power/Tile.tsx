import type { ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import { useNow } from "../../app/core/hooks";
import { Empty, Readout, Scanning, Sparkline, Stat, Tag } from "../../app/ui";
import { describeFrequency, fetchMix, fetchSignal, greenVerdict, useCountry, useFrequencyStore, useFrequencySync } from "./client";
import "./power.css";

/** Briefing tile: the grid frequency now, the renewable share and the green/red signal. */
export default function PowerTile(): ReactElement {
  const { country } = useCountry();
  const frequency = useFrequencySync();
  const t = useFrequencyStore((s) => s.t);
  const hz = useFrequencyStore((s) => s.hz);
  const mix = usePoll((signal) => fetchMix(country, signal), 5 * 60_000, [country]);
  const green = usePoll((signal) => fetchSignal(country, signal), 10 * 60_000, [country]);
  const now = useNow(60_000);

  if (t.length === 0) {
    return frequency.error ? (
      <Empty title="Grid data unavailable" tone="error">
        {frequency.error.message}
      </Empty>
    ) : (
      <Scanning label="Listening to the grid" />
    );
  }

  const latest = hz[hz.length - 1] ?? 50;
  const state = describeFrequency(latest);
  const verdict = green.data ? greenVerdict(green.data, now) : null;
  const share = mix.data ? mix.data.renewableShare[mix.data.t.length - 1] : null;

  return (
    <div className="power-tile">
      <div className="power-tile__beat">
        <Stat label="Grid frequency" value={latest.toFixed(3)} unit="Hz" hint={<Tag tone={state.tone}>{state.label}</Tag>} />
        <div className="power-tile__trace" aria-hidden>
          <Sparkline values={hz.slice(-240)} min={49.9} max={50.1} tone="sodium" height={40} width={180} fill={false} />
          <span className="power-tile__mid" />
        </div>
      </div>
      <Readout
        rows={[
          share != null && ["Renewable share", `${Math.round(share)} % of generation`],
          verdict && [
            "Run appliances",
            <span key="v" className={`power-tile__verdict power-tile__verdict--${verdict.tone}`}>
              {verdict.tone === "mint" ? "Good time now" : verdict.tone === "sodium" ? "Average now" : "Better to wait"}
            </span>,
          ],
        ]}
      />
    </div>
  );
}
