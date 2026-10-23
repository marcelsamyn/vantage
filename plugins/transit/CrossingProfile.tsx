import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard, Tag } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { protectionOf } from "./client";
import "./transit.css";

const PROTECTION = {
  barriers: { label: "Barriers and lights", tone: "mint" },
  lights: { label: "Lights, no barriers", tone: "sodium" },
  passive: { label: "A sign only: no lights, no barriers", tone: "alarm" },
} as const;

/** Profiler for a level crossing on the Belgian network. */
export default function CrossingProfile({ entity, onClose }: ProfilerProps<"crossing">): ReactElement {
  const c = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const p = PROTECTION[protectionOf(c.kind)];
  return (
    <ProfilerCard
      band="Level crossing · Infrabel"
      tone={p.tone}
      name={c.id}
      kicker={c.kind}
      onClose={onClose}
      rows={[
        ["Protection", <Tag key="p" tone={p.tone}>{p.label}</Tag>],
        c.place && ["Place", c.place],
        ["Position", fmt.coord(c.lat, c.lon)],
        here && ["From you", fmt.distance(distanceM(here, c), units)],
      ]}
      source="Infrabel open data · level crossings · CC0"
    />
  );
}
