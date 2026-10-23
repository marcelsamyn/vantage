import { Map as MapIcon } from "lucide-react";
import { motion } from "motion/react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { profile, useIsProfiled } from "../../app/core/profile";
import { Button, Sparkline, Stat } from "../../app/ui";
import { showLayer } from "../city/client";
import { entsogCredit, gasWords } from "./client";
import type { GasCountry, GasFlows, GasSite } from "./types";

const COUNTRY_NAME: Record<GasCountry, string> = { IT: "Italy", BE: "Belgium" };

const COVERAGE: Record<GasCountry, string> = {
  IT: "Covers every cross-border pipeline and every LNG terminal that reports hourly.",
  BE: "Covers the Zeebrugge terminals and the Dutch border. Fluxys publishes no hourly flow at its French and German borders.",
};

function SiteRow({ site, peak, index }: { site: GasSite; peak: number; index: number }): ReactElement {
  const reduced = usePrefersReducedMotion();
  const selected = useIsProfiled("gaspoint", site.id);
  const share = peak > 0 ? Math.abs(site.gwh) / peak : 0;
  const flowing = Math.abs(site.gwh) >= 0.005;
  const inward = site.gwh >= 0;
  return (
    <motion.li
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.4, bounce: 0, delay: index * 0.04 }}
    >
      <button type="button" className={selected ? "power-gas__row power-gas__row--on" : "power-gas__row"} onClick={() => profile.open({ kind: "gaspoint", id: site.id, data: site })}>
        <span className="power-gas__name">
          {site.name}
          <span className="power-gas__origin">{site.origin}</span>
        </span>
        <span className="power-gas__pipe" aria-hidden>
          {flowing ? <span className={inward ? "power-gas__flow" : "power-gas__flow power-gas__flow--out"} style={{ width: `${Math.max(3, share * 100)}%` }} /> : <span className="power-gas__idle" />}
        </span>
        <span className="num power-gas__gwh">{flowing ? `${inward ? "" : "−"}${gasWords(site.gwh)}` : "no flow"}</span>
        <span className="power-gas__spark" aria-hidden>
          <Sparkline values={site.series.map((p) => Math.abs(p.gwh))} tone={inward ? "sodium" : "ice"} height={22} width={90} min={0} max={Math.max(peak, 1)} />
        </span>
      </button>
    </motion.li>
  );
}

function Group({ country, sites, peak }: { country: GasCountry; sites: GasSite[]; peak: number }): ReactElement {
  const total = sites.reduce((s, x) => s + x.gwh, 0);
  const ordered = [...sites].sort((a, b) => b.gwh - a.gwh);
  return (
    <div className="power-gas__group">
      <Stat
        label={`Into ${COUNTRY_NAME[country]}`}
        value={total.toFixed(total >= 100 ? 0 : 1)}
        unit="GWh/h"
        size="lg"
        tone="sodium"
        hint={total > 0 ? `Net of what flows out again. ${COVERAGE[country]}` : COVERAGE[country]}
      />
      <ul className="power-gas__list">
        {ordered.map((s, i) => (
          <SiteRow key={s.id} site={s} peak={peak} index={i} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Where Italy's and Belgium's gas comes in, hour by hour. Each row is a border pipeline or an LNG terminal:
 * the animated bar is its flow, scaled against the biggest on the screen, with two days of history beside it.
 */
export function Gas({ flows, first }: { flows: GasFlows; first: GasCountry }): ReactElement {
  const peak = Math.max(0, ...flows.sites.map((s) => Math.abs(s.gwh)));
  const order: GasCountry[] = first === "BE" ? ["BE", "IT"] : ["IT", "BE"];
  return (
    <div className="power-gas">
      <div className="power-gas__groups">
        {order.map((country) => (
          <Group key={country} country={country} sites={flows.sites.filter((s) => s.country === country)} peak={peak} />
        ))}
      </div>
      <div className="power-gas__foot">
        <p className="power-fine">
          Physical flow in gigawatt hours of energy per hour, as the grid operators report it to the ENTSOG Transparency Platform. Newest hour: {fmt.clock(flows.at * 1000)}, which is normally about two hours behind. Click a row for two days of history. Source: {entsogCredit("Physical Flow")}.
        </p>
        <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("power.gas")}>
          Show gas flows on the map
        </Button>
      </div>
    </div>
  );
}
