import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { go } from "../../app/core/nav";
import { Button, Scanning } from "../../app/ui";
import { useBirds, useMeteors } from "./client";
import "./listen.css";

/** Briefing tile: the bird calling most near you now, and how many meteors crossed Europe's sky last night. */
export default function ListenTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const hour = useBirds(here, "hour");
  // At night nothing sings: fall back to the day so the tile still says who lives here.
  const quiet = hour.data !== undefined && hour.data.detections === 0;
  const day = useBirds(here, "day", !quiet);
  const meteors = useMeteors("europe");

  const birds = quiet ? day.data : hour.data;
  const lead = birds?.top[0];
  const birdsLoading = here !== null && !hour.error && (hour.data === undefined || (quiet && day.data === undefined && !day.error));

  return (
    <div className="listen-tile">
      <div className="listen-tile__cols">
        <div className="listen-tile__col">
          <div className="v-eyebrow">Singing near you</div>
          {!here ? (
            <p className="dim listen-tile__note">Needs your location.</p>
          ) : birdsLoading ? (
            <Scanning label="Listening" />
          ) : lead && birds ? (
            <>
              <div className="listen-tile__species display">{lead.commonName}</div>
              <div className="listen-tile__hint num">
                {fmt.int(lead.count)} {lead.count === 1 ? "call" : "calls"} {birds.window === "hour" ? "in the last hour" : "in the last 24 h"}
              </div>
            </>
          ) : (
            <p className="dim listen-tile__note">{hour.error ? hour.error.message : "No stations within 28 km heard a bird today."}</p>
          )}
        </div>
        <div className="listen-tile__col">
          <div className="v-eyebrow">Meteors last night</div>
          {meteors.data ? (
            <>
              <div className="listen-tile__number display num sodium">{fmt.int(meteors.data.meteors.length)}</div>
              <div className="listen-tile__hint">seen over Europe</div>
            </>
          ) : meteors.error ? (
            <p className="dim listen-tile__note">{meteors.error.message}</p>
          ) : (
            <Scanning label="Counting" />
          )}
        </div>
      </div>
      <div className="listen-tile__actions">
        <Button size="sm" variant="primary" onClick={() => go("listen", { action: "nearest" })}>
          Listen nearby
        </Button>
        <Button size="sm" variant="ghost" onClick={() => go("listen")}>
          Open Listen
        </Button>
      </div>
    </div>
  );
}
