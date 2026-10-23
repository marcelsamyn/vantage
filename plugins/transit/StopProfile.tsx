import { Footprints } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { routeTo } from "../city/client";
import { Board } from "./Board";

/** Profiler for a transit stop: its live departures board. */
export default function StopProfile({ entity, onClose }: ProfilerProps<"stop">): ReactElement {
  const s = entity.data;
  const here = useLocation((st) => st.here);
  const units = useSettings((st) => st.units);
  return (
    <ProfilerCard
      band="Departures"
      tone="ice"
      name={s.name}
      kicker={s.modes.map((m) => m.toLowerCase().replace(/_/g, " ")).join(" · ") || "Stop"}
      onClose={onClose}
      rows={[here && ["From you", fmt.distance(distanceM(here, s), units)]]}
      actions={
        <Button size="sm" icon={<Footprints size={13} />} onClick={() => void routeTo({ lat: s.lat, lon: s.lon, name: s.name }, "foot")}>
          Walk here
        </Button>
      }
    >
      <Board stopId={s.stopId} />
    </ProfilerCard>
  );
}
