import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { openPalette } from "../../app/core/palette";
import { Button, Empty, Readout, Scanning, Stat } from "../../app/ui";
import "./home.css";

const SOURCE_LABEL = { gps: "Device location", ip: "Internet address (approximate)", manual: "Pinned by you" } as const;

export default function HereTile(): ReactElement {
  const now = useNow(1000);
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const note = useLocation((s) => s.note);

  if (!here) {
    return status === "locating" ? <Scanning label="Locating" /> : <Empty title="Location unknown" action={<Button size="sm" onClick={openPalette}>Choose a place</Button>}>{note ?? "VANTAGE could not find you. Pin a place from the command palette."}</Empty>;
  }

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="home-here">
      <Stat label="Local time" value={fmt.clock(now, true)} size="lg" hint={tz.replace(/_/g, " ")} />
      <div className="home-here__details">
        <Readout
          rows={[
            ["Position", fmt.coord(here.lat, here.lon)],
            ["Source", SOURCE_LABEL[here.source]],
            here.accuracyM !== null && ["Accuracy", `± ${fmt.int(here.accuracyM)} m`],
            ["Fixed", fmt.ago(here.at, now)],
          ]}
        />
        {note && <p className="dim" style={{ fontSize: 12 }}>{note}</p>}
        <div>
          <Button size="sm" onClick={openPalette}>
            Pin another place
          </Button>
        </div>
      </div>
    </div>
  );
}
