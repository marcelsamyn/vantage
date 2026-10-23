import type { ReactElement } from "react";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { Readout } from "../../app/ui";

import { fetchPricing } from "./client";

/**
 * What the operator charges for a vehicle on the map. The plans come from the system's own GBFS pricing feed, so
 * this asks only once per operator and says nothing for a thing no operator reported.
 */
export default function Pricing({ entity }: ProfilerSectionProps<"thing">): ReactElement | null {
  const member = entity.data.members.find((m) => m.source === "bikes.gbfs");
  // A vehicle's id is "<system id>~<vehicle id>"; the pricing route looks the feed up by the system.
  const system = member?.thing.id.split("~")[0] ?? null;
  const { data } = usePoll((signal) => fetchPricing(system ?? "", signal), null, [system], system === null);
  const plans = data?.plans ?? [];
  if (plans.length === 0) return null;
  return (
    <section>
      <h4 className="v-eyebrow">What it costs</h4>
      <Readout rows={plans.map((plan, i) => [i === 0 ? "Plan" : "", plan])} />
    </section>
  );
}
