import { useMemo, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { Readout, Stat, Tag } from "../../app/ui";
import { centsPerKwh, dayWord, greenVerdict, priceAt, slotAt, ZONE_LABEL } from "./client";
import type { GreenSignal, PricePoints } from "./types";

const H = 120;

/** The day-ahead wholesale price for the bidding zone, today and (once published) tomorrow, with the current slot marked. */
export function Price({ price }: { price: PricePoints }): ReactElement {
  const now = useNow(30_000);
  const current = priceAt(price, now);
  const { bars, min, max, cheapest } = useMemo(() => {
    const lo = Math.min(...price.eurMwh);
    const hi = Math.max(...price.eurMwh);
    // The cheapest three hours in a row: the best window for anything that can wait.
    const span = Math.min(12, price.eurMwh.length);
    let best = 0;
    let bestSum = Infinity;
    for (let i = 0; i + span <= price.eurMwh.length; i++) {
      const sum = price.eurMwh.slice(i, i + span).reduce((a, b) => a + b, 0);
      if (sum < bestSum) {
        bestSum = sum;
        best = i;
      }
    }
    return { bars: price.eurMwh, min: lo, max: hi, cheapest: { from: price.t[best] ?? 0, to: (price.t[best + span - 1] ?? 0) + 900, avg: bestSum / span } };
  }, [price]);

  const range = Math.max(1, max - Math.min(0, min));
  const floor = Math.min(0, min);
  const nowIndex = slotAt(price.t, now / 1000);
  const rank = current ? [...price.eurMwh].sort((a, b) => a - b).findIndex((v) => v >= current.eurMwh) / Math.max(1, price.eurMwh.length - 1) : null;
  const days = new Set(price.t.map((t) => new Date(t * 1000).toLocaleDateString("en-CA")));

  return (
    <div className="power-price">
      <Stat
        label={`Day-ahead price now · ${ZONE_LABEL[price.zone]}`}
        value={current ? fmt.one(current.eurMwh) : "—"}
        unit="€ / MWh"
        size="lg"
        hint={current ? `${centsPerKwh(current.eurMwh)} wholesale, before grid fees, taxes and the supplier's margin` : undefined}
      />
      <div className="power-bars" role="img" aria-label="Day-ahead price for each quarter hour">
        <svg viewBox={`0 0 ${bars.length} ${H}`} preserveAspectRatio="none" height={H} width="100%">
          {bars.map((v, i) => {
            const h = ((Math.max(v, floor) - floor) / range) * (H - 6) + 2;
            const isNow = i === nowIndex;
            const cheap = rank !== null && v <= min + (max - min) * 0.2;
            return <rect key={price.t[i]} x={i + 0.12} y={H - h} width={0.76} height={h} className={`power-bars__bar${isNow ? " power-bars__bar--now" : ""}${cheap ? " power-bars__bar--cheap" : ""}`} />;
          })}
          {nowIndex >= 0 && <line x1={nowIndex + 0.5} x2={nowIndex + 0.5} y1={0} y2={H} className="power-bars__now" vectorEffect="non-scaling-stroke" />}
        </svg>
        <div className="power-bars__axis num">
          <span>{fmt.clock((price.t[0] ?? 0) * 1000)}</span>
          {days.size > 1 && <span>tomorrow</span>}
          <span>{fmt.clock(((price.t[price.t.length - 1] ?? 0) + 900) * 1000)}</span>
        </div>
      </div>
      <Readout
        rows={[
          ["Cheapest 3 hours", `${fmt.clock(cheapest.from * 1000)}${dayWord(cheapest.from * 1000, now)} to ${fmt.clock(cheapest.to * 1000)}, about ${fmt.int(cheapest.avg)} € / MWh`],
          ["Range", `${fmt.int(min)} to ${fmt.int(max)} € / MWh`],
          rank !== null && ["Right now", rank < 0.33 ? <Tag key="r" tone="mint">Among the cheapest hours</Tag> : rank > 0.66 ? <Tag key="r" tone="sodium">Among the dearest hours</Tag> : "Mid-priced"],
        ]}
      />
      <p className="power-fine">Day-ahead prices are fixed in a European auction the day before. {price.licence}.</p>
    </div>
  );
}

/** The plain-words advice for running heavy appliances, from the grid's green/red forecast. */
export function Signal({ signal }: { signal: GreenSignal }): ReactElement {
  const now = useNow(30_000);
  const verdict = greenVerdict(signal, now);
  if (!verdict) return <p className="power-fine">The forecast has run out. It refreshes when the source publishes the next one.</p>;
  return (
    <div className={`power-signal power-signal--${verdict.tone}`}>
      <span className="power-signal__light" aria-hidden />
      <div>
        <p className="power-signal__headline">{verdict.headline}</p>
        {verdict.next && <p className="power-signal__next">{verdict.next}</p>}
        <p className="power-fine">Share of demand met by renewable power, forecast by Energy-Charts{signal.substitute ? " from past patterns, because live forecasts are missing" : ""}.</p>
      </div>
    </div>
  );
}
