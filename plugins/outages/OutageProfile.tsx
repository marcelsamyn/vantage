import type { ReactElement } from "react";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard } from "../../app/ui";
import { outageRows } from "./details";

export default function OutageProfile({ entity, onClose }: ProfilerProps<"outage">): ReactElement {
  const event = entity.data;
  return <ProfilerCard band="Internet event" name={event.description ?? event.eventType} tone="alarm" rows={outageRows(event)} source="Cloudflare Radar" onClose={onClose}
    actions={<a className="v-btn v-btn--sm v-btn--ghost" href={event.linkedUrl ?? "https://radar.cloudflare.com/outage-center"} target="_blank" rel="noreferrer">Open Cloudflare Radar</a>} />;
}
