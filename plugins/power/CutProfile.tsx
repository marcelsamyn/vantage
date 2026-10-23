import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { ProfilerCard, Tag } from "../../app/ui";
import "./power.css";

const clock = (unixS: number): string => `${fmt.clock(unixS * 1000)}, ${new Date(unixS * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;

/** Profiler for a power cut on the Liander grid: cause, crew status and when the operator expects it fixed. */
export default function CutProfile({ entity, onClose }: ProfilerProps<"powercut">): ReactElement {
  const c = entity.data;
  const now = useNow(60_000);
  const planned = c.type === "planned";
  return (
    <ProfilerCard
      band={planned ? "Planned work · Liander grid" : "Power cut · Liander grid"}
      tone={c.status === "fixed" ? "mint" : planned ? "sodium" : "alarm"}
      name={c.streets[0] ? `${c.streets[0]}${c.streets.length > 1 ? ` and ${c.streets.length - 1} more` : ""}` : "Area near Amsterdam"}
      kicker={c.causeText}
      onClose={onClose}
      rows={[
        ["Status", <Tag key="s" tone={c.status === "fixed" ? "mint" : planned ? "sodium" : "alarm"}>{c.statusText}</Tag>],
        ["Reported", `${clock(c.reported)}, ${fmt.ago(c.reported * 1000, now)}`],
        c.fixed && c.status === "fixed" && ["Fixed", clock(c.fixed)],
        c.estimatedFix && c.status !== "fixed" && ["Expected fix", `${clock(c.estimatedFix)}, ${fmt.until(c.estimatedFix * 1000, now)}`],
        ["Customers affected", c.customers],
        c.streets.length > 1 && ["Streets", c.streets.join(", ")],
      ]}
      fact="Liander reports each cut as an area and a bucket (fewer than 25, 50, 100 customers), never a name or an address."
      source="Liander via City of Amsterdam open data · CC BY · today's cuts, Amsterdam region"
    />
  );
}
