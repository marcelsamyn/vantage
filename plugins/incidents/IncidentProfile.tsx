import type { ReactElement } from "react";
import { ExternalLink } from "lucide-react";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard } from "../../app/ui";
import { fetchIncidents } from "./client";
import { SOURCES } from "./model";
import "./incidents.css";

function time(at: number | null): string {
  return at === null ? "Not published" : new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export default function IncidentProfile({ entity, onClose }: ProfilerProps<"incident">): ReactElement {
  const snapshot = entity.data;
  const source = SOURCES[snapshot.source];
  const { data, error, loading } = usePoll((signal) => fetchIncidents(snapshot.source, source.box, signal), source.refreshMs, [snapshot.id]);
  const current = data?.incidents.find((item) => item.id === snapshot.id);
  const item = current ?? snapshot;
  return <ProfilerCard band="Emergency incident" name={item.title} kicker={item.location} tone={item.alert ? "alarm" : "sodium"} onClose={onClose} loading={loading && !data}
    rows={[["Incident", <a href={item.href} target="_blank" rel="noreferrer noopener">{item.number}</a>], ["Status", item.status], ["Started", time(item.startedAt)], ["Updated", time(item.updatedAt)], ["Position", `${item.lat}, ${item.lon}`], ...item.rows]}
    fact={source.coverage}
    actions={<a className="v-btn v-btn--sm v-btn--ghost" href={item.href} target="_blank" rel="noreferrer noopener"><ExternalLink size={13} /> Open official incident information</a>}
    source={source.credit}>
    {error && <p className="incidents-note" role="status">Refresh failed: {error.message}. Showing the last report. Retry by reopening the profile.</p>}
    {data && !current && <p className="incidents-note" role="status">This incident is no longer in the feed. Its last report is shown; its closure time was not published.</p>}
    <p className="incidents-note">Fetched {time(data?.fetchedAt ?? null)}. Refresh every {source.refreshMs / 60000} minutes. Read the official source for instructions and the latest status.</p>
  </ProfilerCard>;
}
