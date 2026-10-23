import { motion } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { usePoll, useStoredState } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { Empty, Page, Panel, Scanning } from "../../app/ui";
import { Belgium } from "./Belgium";
import { fetchBelgium, fetchGas, fetchMix, fetchNuclear, fetchPrice, fetchSignal, useCountry, useFrequencySync, useFrequencyStore, zoneFor, ZONE_LABEL } from "./client";
import { Gas } from "./Gas";
import Heartbeat, { HeartbeatError } from "./Heartbeat";
import { Mix } from "./Mix";
import { Nuclear } from "./Nuclear";
import { Price, Signal } from "./Price";
import { COUNTRIES, type Zone } from "./types";
import "./power.css";

/** One slow query: shows the loading, error and result states the same way everywhere on the screen. */
function Load<T>({ polled, label, children }: { polled: { data: T | undefined; error: Error | null }; label: string; children: (data: T) => ReactNode }): ReactElement {
  if (polled.data !== undefined) return <>{children(polled.data)}</>;
  if (polled.error) return <Empty title={`${label} unavailable`} tone="error">{polled.error.message} It will retry by itself.</Empty>;
  return <Scanning label={`Reading ${label.toLowerCase()}`} />;
}

export default function PowerScreen(): ReactElement {
  const { country, picked, setCountry } = useCountry();
  const here = useLocation((s) => s.here);
  const meta = COUNTRIES.find((c) => c.code === country) ?? COUNTRIES[0];
  const auto = zoneFor(country, here);
  const [zonePick, setZonePick] = useStoredState<Zone | null>("power:zone", null);
  const zone = zonePick && meta.zones.some((z) => z === zonePick) ? zonePick : auto;

  const frequency = useFrequencySync();
  const hasTrace = useFrequencyStore((s) => s.t.length > 0);
  const mix = usePoll((signal) => fetchMix(country, signal), 5 * 60_000, [country]);
  const price = usePoll((signal) => fetchPrice(zone, signal), 15 * 60_000, [zone]);
  const green = usePoll((signal) => fetchSignal(country, signal), 10 * 60_000, [country]);
  const belgium = usePoll((signal) => fetchBelgium(signal), 90_000, []);

  const nuclear = usePoll((signal) => fetchNuclear(signal), 10 * 60_000, []);
  const gas = usePoll((signal) => fetchGas(signal), 10 * 60_000, []);

  const belgiumPanel = (
    <Panel title="Belgium · cross-border flows and balance" key="be" className="power-span">
      <Load polled={belgium} label="Elia's data">
        {(grid) => <Belgium grid={grid} />}
      </Load>
    </Panel>
  );

  const nuclearPanel = (
    <Panel title="Belgium · nuclear reactors" key="nuclear" className="power-span">
      <Load polled={nuclear} label="Elia's reactor list">
        {(fleet) => <Nuclear fleet={fleet} />}
      </Load>
    </Panel>
  );

  return (
    <Page
      eyebrow="Power"
      title="Power"
      lede="Every generator from Portugal to Poland spins in step with the number below: 50 hertz. When a power plant trips, the whole continent slows a little, and the reserves answer within seconds."
      actions={
        <>
          <label className="power-pick">
            <span className="v-eyebrow">Country</span>
            <select
              className="power-select"
              value={country}
              onChange={(e) => {
                const next = COUNTRIES.find((c) => c.code === e.target.value);
                if (next) setCountry(next.code);
              }}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {meta.zones.length > 1 && (
            <label className="power-pick">
              <span className="v-eyebrow">Price zone</span>
              <select className="power-select" value={zone} onChange={(e) => setZonePick(e.target.value as Zone)}>
                {meta.zones.map((z) => (
                  <option key={z} value={z}>
                    {ZONE_LABEL[z]}
                    {z === auto ? " (your position)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      }
    >
      <div className="power-grid">
        <motion.div className="power-span" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", duration: 0.5, bounce: 0 }}>
          <Panel title="Heartbeat" solid>
            {!hasTrace && frequency.error ? <HeartbeatError message={frequency.error.message} /> : <Heartbeat />}
          </Panel>
        </motion.div>

        {country === "be" && belgiumPanel}
        {country === "be" && nuclearPanel}

        <Panel title={`Where ${meta.name}'s electricity comes from`} className="power-wide">
          <Load polled={mix} label="Generation data">
            {(data) => <Mix mix={data} countryName={meta.name} />}
          </Load>
          <p className="power-fine">
            Generation, demand and prices: Energy-Charts by Fraunhofer ISE (CC BY 4.0). {picked ? "You chose this country." : "Chosen from your position."} Grid operators report with a delay of one to three hours.
          </p>
        </Panel>

        <div className="power-stack">
          <Panel title="Green or red?">
            <Load polled={green} label="The green signal">
              {(data) => <Signal signal={data} />}
            </Load>
          </Panel>
          <Panel title="Day-ahead price">
            <Load polled={price} label="Prices">
              {(data) => <Price price={data} />}
            </Load>
          </Panel>
        </div>

        {country !== "be" && belgiumPanel}
        {country !== "be" && nuclearPanel}

        <Panel title="Natural gas · into Italy and Belgium" className="power-span">
          <Load polled={gas} label="Gas flows">
            {(flows) => <Gas flows={flows} first={country === "be" ? "BE" : "IT"} />}
          </Load>
        </Panel>
      </div>
    </Page>
  );
}
