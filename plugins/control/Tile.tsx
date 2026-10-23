import type { ReactElement } from "react";
import { go } from "../../app/core/nav";
import { Button, LiveDot, Readout, Scanning, Stat } from "../../app/ui";
import { act, capabilityOf, LOW_SUPPLY_PERCENT, thisMac, useBusy, useDevices } from "./client";
import "./control.css";

/** Home tile: whether this Mac is kept awake, what is playing, and any printer supply running low. */
export default function ControlTile(): ReactElement {
  const { data, error } = useDevices(30_000);
  const mac = data ? thisMac(data.devices) : undefined;
  const awake = capabilityOf(mac, "switch", "awake");
  const busy = useBusy(mac?.id ?? "", "awake");
  if (!data) return error ? <p className="dim">Could not read your devices. Open Control for details.</p> : <Scanning label="Reading your devices" />;

  const media = data.devices.flatMap((d) => {
    const m = capabilityOf(d, "media");
    return m?.track ? [{ device: d, media: m }] : [];
  });
  const playing = media.find((m) => m.media.state === "playing") ?? media[0];
  const printers = data.devices.filter((d) => capabilityOf(d, "supplies"));
  const low = printers.flatMap((d) => (capabilityOf(d, "supplies")?.supplies ?? []).filter((s) => s.percent !== null && s.percent < LOW_SUPPLY_PERCENT).map((s) => ({ device: d, supply: s })));

  return (
    <div className="control-tile">
      <div className="control-tile__stats">
        <Stat
          size="sm"
          label="Keep awake"
          value={
            awake ? (
              <span className={awake.on ? "ice" : undefined}>
                {awake.on && <LiveDot />} {awake.on ? "On" : "Off"}
              </span>
            ) : (
              "—"
            )
          }
        />
        <Stat size="sm" label="Devices" value={data.devices.length} hint={`${data.devices.filter((d) => !d.local).length} on your network`} />
      </div>
      <Readout
        rows={[
          ["Playing", playing?.media.track ? `${playing.media.track.title}${playing.media.track.artist ? ` · ${playing.media.track.artist}` : ""}${playing.media.state === "playing" ? "" : " (paused)"}` : "Nothing"],
          [
            "Printers",
            low.length ? (
              <span className="alarm">{low.map((l) => `${l.supply.name} ${l.supply.type} ${l.supply.percent} %`).join(", ")}</span>
            ) : printers.length ? (
              "Supplies fine"
            ) : (
              "None found"
            ),
          ],
        ]}
      />
      <div className="control-tile__actions">
        {mac && awake && (
          <Button size="sm" variant="ghost" on={awake.on} disabled={busy} onClick={() => void act<"switch">(mac, "awake", !awake.on)}>
            {awake.on ? "Let it sleep" : "Keep awake"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => go("control", { action: "open" })}>
          Open Control
        </Button>
      </div>
    </div>
  );
}
