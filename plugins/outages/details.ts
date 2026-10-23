import type { ThingRow } from "../../app/core/things";
import type { Outage } from "./types";

export function outageRows(event: Outage): ThingRow[] {
  const rows: ThingRow[] = [
    ["Status", event.endDate ? `Ended ${new Date(event.endDate).toLocaleString()}` : "End not reported"],
    ["Started", new Date(event.startDate).toLocaleString()], ["Event", event.eventType], ["Data", event.dataSource],
  ];
  if (event.scope) rows.push(["Scope", event.scope]);
  if (event.outage) rows.push(["Type", event.outage.outageType], ["Cause", event.outage.outageCause]);
  if (event.description) rows.push(["Description", event.description]);
  if (event.locations.length) rows.push(["Countries", event.locationsDetails.flatMap((l) => l ? [l.name] : []).join(", ") || event.locations.join(", ")]);
  if (event.asns.length) rows.push(["Networks", event.asnsDetails.length ? event.asnsDetails.map((a) => `AS${a.asn} ${a.name ?? ""}`).join(", ") : event.asns.map((a) => `AS${a}`).join(", ")]);
  if (event.entities.length) rows.push(["Entities", event.entities.map((e) => `${e.entityType}: ${e.entityName ?? e.entityValue}`).join(", ")]);
  if (event.origins.length) rows.push(["Origins", event.originsDetails.map((o) => o.name ?? o.origin).join(", ") || event.origins.join(", ")]);
  if (event.geoIds.length) rows.push(["GeoNames", event.geoIds.join(", ")]);
  if (event.tags.length) rows.push(["Tags", event.tags.join(", ")]);
  return rows;
}
