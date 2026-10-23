import type { ReactElement } from "react";
import type { HealthReport } from "../../shared/health";
import { api } from "../../app/core/api";
import { usePoll } from "../../app/core/hooks";
import { Empty, LiveDot, Scanning } from "../../app/ui";
import "./home.css";

/** Every public source the plugins depend on, with whether it answers right now. */
export default function LinksTile(): ReactElement {
  const { data, error } = usePoll((signal) => api<HealthReport>("/api/core/health", { signal }), 60_000, []);
  if (error && !data) return <Empty title="Server offline" tone="error">{error.message}</Empty>;
  if (!data) return <Scanning label="Checking links" />;
  const up = data.probes.filter((p) => p.ok).length;
  return (
    <div className="home-links">
      <div className="v-stat__hint">
        {up} of {data.probes.length} answering
      </div>
      <ul className="home-links__list">
        {data.probes.map((p) => (
          <li key={`${p.plugin}:${p.name}`} className="home-links__item" title={p.detail ?? undefined}>
            <LiveDot tone={p.ok ? "mint" : "alarm"} live={false} />
            <span className="home-links__name">{p.name}</span>
            <span className="home-links__ms num">{p.ok ? `${p.ms} ms` : "down"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
