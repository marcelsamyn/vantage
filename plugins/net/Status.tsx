import { type ReactElement } from "react";
import { go } from "../../app/core/nav";
import { LiveDot } from "../../app/ui";
import { useThroughput } from "./client";
import { rateParts } from "./labels";

/** Status bar item: whether this Mac is online, and how fast data is arriving. */
export default function NetStatus(): ReactElement {
  const { samples, online } = useThroughput(2_000);
  const last = samples[samples.length - 1];
  const down = rateParts(last?.down ?? 0);
  return (
    <button type="button" className="v-status-item" onClick={() => go("net", { action: "overview" })} title={online ? "Online · open Network" : "Offline · open Network"}>
      <LiveDot tone={online ? "mint" : "alarm"} live={online} />
      {online ? (
        <span className="num bar__hide-sm">
          ↓ {down.value} {down.unit}
        </span>
      ) : (
        <span className="bar__hide-sm">Offline</span>
      )}
    </button>
  );
}
