import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { Empty, Scanning, Tag } from "../../app/ui";
import type { LatLon } from "../../shared/geo";
import { useGalileo } from "./client";
import type { GalileoSatellite, SatelliteHealth } from "./types";
import "./gnss.css";

const TONE: Record<SatelliteHealth, "mint" | "ice" | "alarm" | undefined> = { healthy: "mint", testing: "ice", unhealthy: "alarm", unknown: undefined };
const WORDS: Record<SatelliteHealth, string> = { healthy: "Healthy", testing: "Testing", unhealthy: "Unhealthy", unknown: "Unknown" };

/** The service centre writes notices in capitals. Sentence case reads better, but identifiers and acronyms keep theirs. */
function sentence(text: string): string {
  const lower = text.toLowerCase().replace(/\b(gsat\d+|osnma|nagu|utc)\b/g, (m) => m.toUpperCase()).replace(/\bhas service/g, "HAS service");
  return lower.replace(/^\w/, (c) => c.toUpperCase());
}

const day = (unixS: number): string => new Date(unixS * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Sky panel: which Galileo satellites the European GNSS Service Centre calls usable, and its latest notices. */
export default function GalileoPanel(_props: { observer: LatLon }): ReactElement {
  const { data, error } = useGalileo();
  if (!data) return error ? <Empty title="Galileo status unavailable" tone="error">{error.message}</Empty> : <Scanning label="Reading the service centre" />;

  const by = (h: SatelliteHealth): GalileoSatellite[] => data.satellites.filter((s) => s.health === h);
  const attention = data.satellites.filter((s) => s.health !== "healthy");

  return (
    <div className="gnss-panel">
      <div className="gnss-panel__summary">
        <span className="gnss-panel__count num">
          {by("healthy").length}
          <small> of {data.satellites.length}</small>
        </span>
        <span className="gnss-panel__label">satellites healthy</span>
        <span className="gnss-panel__tags">
          {(["testing", "unhealthy"] as const).map((h) => by(h).length > 0 && <Tag key={h} tone={TONE[h]}>{`${by(h).length} ${WORDS[h].toLowerCase()}`}</Tag>)}
        </span>
      </div>

      <ul className="gnss-sats" aria-label="Every Galileo satellite and its status">
        {data.satellites.map((s) => (
          <li key={s.name} className={`gnss-sat gnss-sat--${s.health}`} title={`${s.name} · ${s.statusText.toLowerCase()}`}>
            {s.svid}
          </li>
        ))}
      </ul>

      {attention.length > 0 && (
        <dl className="gnss-issues">
          {attention.map((s) => (
            <div key={s.name} className="gnss-issue">
              <dt>
                <span className="num">{s.name}</span> <Tag tone={TONE[s.health]}>{s.statusText.toLowerCase()}</Tag>
              </dt>
              <dd>{s.subject ? sentence(s.subject) : "No notice is linked to this status."}</dd>
            </div>
          ))}
        </dl>
      )}

      <h3 className="v-eyebrow gnss-panel__head">Latest notices to Galileo users</h3>
      <ul className="gnss-notices">
        {data.notices.slice(0, 4).map((n) => (
          <li key={n.id}>
            <a href={n.url} target="_blank" rel="noreferrer" className="gnss-notice">
              <span className="gnss-notice__subject">{sentence(n.subject)}</span>
              <span className="gnss-notice__meta num">
                NAGU {n.id} · {day(n.published)}
                {n.affected && n.affected !== "ALL" ? ` · ${n.affected}` : n.affected ? " · all satellites" : ""}
                {n.end && n.end * 1000 > Date.now() ? ` · until ${fmt.clock(n.end * 1000)}` : ""}
              </span>
            </a>
          </li>
        ))}
      </ul>
      <p className="gnss-fine">European GNSS Service Centre (gsc-europa.eu). A notice is a warning to users, not proof that your receiver is affected.</p>
    </div>
  );
}
