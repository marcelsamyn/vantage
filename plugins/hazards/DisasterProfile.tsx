import { ExternalLink } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { DISASTER_NAME } from "./client";

const day = (iso: string): string => new Date(`${iso}Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

/** Profiler for a GDACS disaster alert. */
export default function DisasterProfile({ entity, onClose }: ProfilerProps<"disaster">): ReactElement {
  const d = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  return (
    <ProfilerCard
      band={`${d.alert} alert · ${DISASTER_NAME[d.type]}`}
      tone={d.alert === "Red" ? "alarm" : "sodium"}
      name={d.name}
      kicker={d.countries || "At sea or unassigned"}
      onClose={onClose}
      rows={[
        ["Period", `${day(d.from)} – ${day(d.to)}`],
        d.severity && ["Severity", d.severity],
        here && ["From you", fmt.distance(distanceM(here, d), units)],
      ]}
      fact={
        d.alert === "Red"
          ? "Red means GDACS expects a high humanitarian impact and that international help may be needed."
          : "Orange means a medium expected impact; national authorities usually handle the response."
      }
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={d.url} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> GDACS report
        </a>
      }
      source="GDACS: Global Disaster Alert and Coordination System (UN, European Commission)"
    />
  );
}
