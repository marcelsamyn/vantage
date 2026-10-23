import "./net.css";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { go } from "../../app/core/nav";
import { Button, Meter, Readout, Scanning } from "../../app/ui";
import { useDeviceStore, useSpeed, useWifi } from "./client";
import { bandLabel, signalQuality } from "./labels";

/** Home tile: how good the Wi-Fi link is, how many devices share the network and the last speed test. */
export default function NetTile(): ReactElement {
  const wifi = useWifi(60_000);
  const devices = useDeviceStore((s) => s.latest);
  const history = useSpeed((s) => s.history);
  const now = useNow(60_000);
  const last = history[history.length - 1];
  const w = wifi.data?.current;
  const quality = w?.signalDbm != null ? signalQuality(w.signalDbm) : null;

  return (
    <div className="net-tile">
      {!wifi.data && !devices ? (
        <Scanning label="Reading network" />
      ) : (
        <>
          <Readout
            rows={[
              ["Wi-Fi", w ? `Channel ${w.channel} · ${bandLabel(w.band)}` : "Not connected"],
              quality && w?.signalDbm != null && ["Signal", <span key="q" className={quality.tone}>{quality.label} · {w.signalDbm} dBm</span>],
              ["Devices", devices ? `${devices.devices.length} on ${devices.subnet ?? "your network"}` : "Looking…"],
              ["Last test", last ? `${fmt.int(last.downMbps)} down · ${fmt.int(last.upMbps)} up Mb/s · ${fmt.int(last.pingMs)} ms · ${fmt.ago(last.at, now)}` : "Not run yet"],
            ]}
          />
          {w?.signalDbm != null && <Meter value={Math.max(0, Math.min(1, (w.signalDbm + 90) / 60))} tone={quality?.tone} ticks />}
        </>
      )}
      <div className="net-tile__actions">
        <Button size="sm" variant="ghost" onClick={() => go("net", { action: "devices" })}>
          Who's on my Wi-Fi?
        </Button>
        <Button size="sm" variant="ghost" onClick={() => go("net", { action: "speed" })}>
          Run speed test
        </Button>
      </div>
    </div>
  );
}
