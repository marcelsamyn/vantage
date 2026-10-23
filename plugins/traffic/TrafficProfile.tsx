import { useSettings } from "../../app/core/settings";
import type { ReactElement } from "react";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard } from "../../app/ui";
import { trafficRows } from "./display";
import { TRAFFIC_SOURCES } from "./types";
export default function TrafficProfile({
  entity,
}: ProfilerProps<"roadtraffic">): ReactElement {
  const units = useSettings((s) => s.units);
  const e = entity.data;
  const source = TRAFFIC_SOURCES.find((s) => s.id === e.source);
  return (
    <ProfilerCard
      band="Road disruption"
      name={e.location || e.title}
      kicker={e.title}
      tone="sodium"
      rows={trafficRows(e, units)}
      source={source?.credit}
      actions={
        <a
          className="v-btn v-btn--sm v-btn--ghost"
          href={e.url}
          target="_blank"
          rel="noreferrer"
        >
          Open source
        </a>
      }
    />
  );
}
