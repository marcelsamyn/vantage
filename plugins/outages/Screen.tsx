import type { ReactElement } from "react";
import { profile } from "../../app/core/profile";
import { Empty, Page, Scanning } from "../../app/ui";
import { useOutages } from "./client";
import "./outages.css";

export default function OutagesScreen(): ReactElement {
  const { data, loading, error } = useOutages();
  return <Page eyebrow="Signals" title="Internet outages" lede="Outages and traffic anomalies reported in the past seven days. Map markers represent countries; each event states its own scope.">
    {loading && !data && <Scanning label="Reading Cloudflare Radar" />}
    {error && <Empty title="Radar could not load" tone="error">{error.message}</Empty>}
    {data && <>
      <p className="outages-meta num">Checked {new Date(data.fetchedAt).toLocaleTimeString()} · {data.events.length} events{data.capped ? " · first 1,000 records" : ""}</p>
      {!data.events.length && <Empty title="No events reported">Cloudflare Radar returned no outages or anomalies for the past seven days. The list checks again in five minutes.</Empty>}
      <div className="outages-list">{data.events.map((event) => <button key={event.id} className="outages-event" onClick={() => profile.open({ kind: "outage", id: event.id, data: event })}>
        <span>{event.description ?? event.eventType}</span><small>{event.locations.join(", ") || "Location not reported"} · {event.outage?.outageType ?? event.scope ?? event.eventType} · {event.endDate ? "Ended" : "End not reported"}</small>
      </button>)}</div>
    </>}
  </Page>;
}
