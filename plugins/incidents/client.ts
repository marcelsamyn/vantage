import { api, qs } from "../../app/core/api";
import type { IncidentBox, IncidentSource, Incidents } from "./types";

export function fetchIncidents(source: IncidentSource, box: IncidentBox, signal?: AbortSignal): Promise<Incidents> {
  return api<Incidents>(qs("/api/incidents", { source, ...box }), { signal });
}
