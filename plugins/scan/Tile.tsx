import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { go } from "../../app/core/nav";
import { Button, Stat } from "../../app/ui";
import { useSentry } from "./store";

/** Reads only the sentry's saved events. The tile never opens a camera. */
export default function ScanTile(): ReactElement {
  const last = useSentry((s) => s.lastEvent);
  const now = useNow(15_000);
  return (
    <div className="scan-tile">
      {last ? (
        <div className="scan-tile__last">
          {last.thumb && <img className="scan-tile__thumb" src={last.thumb} alt="" />}
          <Stat label="Last motion" value={fmt.clock(last.at, true)} size="sm" tone="alarm" hint={`${fmt.ago(last.at, now)} · ${fmt.one(last.amount)}% changed`} />
        </div>
      ) : (
        <p className="scan-tile__empty">No motion seen yet. Sentry runs only while the Scan screen is open.</p>
      )}
      <Button size="sm" onClick={() => go("scan")}>
        Open Scan
      </Button>
    </div>
  );
}
