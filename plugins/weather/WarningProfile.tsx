import { ExternalLink, Map as MapIcon } from "lucide-react";
import type { ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Button, ProfilerCard, Scanning, type Tone } from "../../app/ui";
import { showLayer } from "../city/client";
import { fetchMunicipalities, isActive, LEVEL_MEANING, LEVEL_WORDS, warningWindow, useWarnings } from "./client";
import type { OfficialWarning, WarningLevel } from "./types";
import "./weather.css";

const TONE: Record<WarningLevel, Tone> = { yellow: "sodium", orange: "sodium", red: "alarm" };

const dayTime = (unixS: number): string => new Date(unixS * 1000).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

const SOURCE: Record<OfficialWarning["source"], { band: string; credit: string }> = {
  meteoalarm: { band: "Official weather warning", credit: "MeteoAlarm (EUMETNET) with the national weather service. Terms equivalent to CC BY 4.0" },
  dpc: { band: "Civil protection alert", credit: "Dipartimento della Protezione Civile · CC BY 4.0" },
};

function Municipalities({ zone, count }: { zone: string; count: number }): ReactElement {
  const { data, error } = usePoll((signal) => fetchMunicipalities(zone, signal), null, [zone]);
  return (
    <details className="weather-towns">
      <summary>{count} municipalities in this zone</summary>
      {data ? <p>{data.join(", ")}</p> : error ? <p>{error.message}</p> : <Scanning label="Listing" />}
    </details>
  );
}

/** Profiler for an official warning: what it says, who issued it, when it applies and what else is in force there. */
export default function WarningProfile({ entity, onClose }: ProfilerProps<"warning">): ReactElement {
  const w = entity.data;
  const { data } = useWarnings();
  const also = (data?.warnings ?? []).filter((o) => o.id !== w.id && o.areaId !== null && o.areaId === w.areaId && o.until * 1000 > Date.now());
  const meta = SOURCE[w.source];
  const italyMeteoalarm = w.source === "meteoalarm" && w.country === "IT";

  return (
    <ProfilerCard
      key={w.id}
      band={`${LEVEL_WORDS[w.level]} · ${meta.band}`}
      tone={TONE[w.level]}
      name={`${w.hazard} in ${w.area}`}
      kicker={`${isActive(w) ? "In force" : "Starts"} ${warningWindow(w)}`}
      onClose={onClose}
      rows={[
        ["Level", `${LEVEL_WORDS[w.level]}. ${LEVEL_MEANING[w.level]}`],
        ["Valid", `${dayTime(w.from)} to ${dayTime(w.until)}`],
        ["Issued by", w.issuer],
        w.text && ["Expected", w.text],
        w.advice && ["Advice", w.advice],
        also.length > 0 && ["Also here", [...new Set(also.map((o) => `${LEVEL_WORDS[o.level]} ${o.hazard.toLowerCase()}`))].join(" · ")],
      ]}
      fact={
        italyMeteoalarm
          ? "MeteoAlarm Italy says how intense the weather will be, not what damage to expect. The Civil Protection alerts are the official warnings of impact."
          : "Colours follow the European code. Yellow means be aware, orange means be prepared, red means take action."
      }
      actions={
        <>
          <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("weather.warnings")}>
            Show on map
          </Button>
          {w.url && (
            <a className="v-btn v-btn--sm v-btn--ghost" href={w.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} /> Issuer
            </a>
          )}
        </>
      }
      source={meta.credit}
    >
      {w.municipalityCount !== null && <Municipalities zone={w.area} count={w.municipalityCount} />}
    </ProfilerCard>
  );
}
