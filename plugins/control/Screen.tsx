import { ArrowLeft, Power, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useIntent, type Intent } from "../../app/core/nav";
import { Button, Empty, IconButton, Page, Panel, Scanning, Stat } from "../../app/ui";
import { blackoutPlan, runBlackout } from "./blackout";
import { act, capabilityOf, thisMac, useControl, useDevices } from "./client";
import { askConfirm, ConfirmHost } from "./Confirm";
import { Constellation } from "./Constellation";
import { choose, DevicePanel } from "./Controls";
import { NowPlayingPanel, PrintersPanel, ShortcutsPanel } from "./Panels";
import type { Device } from "./types";
import "./control.css";

const say = (title: string, detail?: string): void => feed({ level: "info", source: "control", title, detail, go: { screen: "control", action: "open" } }, { toast: true });

async function blackout(devices: readonly Device[]): Promise<void> {
  const steps = blackoutPlan(devices);
  if (!steps.length) return say("Nothing to black out", "No lights are on, nothing is playing, and the display cannot be put to sleep from here.");
  const ok = await askConfirm({ title: "Blackout", body: "VANTAGE will do exactly this, in this order:", steps: steps.map((s) => s.text), action: "Black out", danger: true });
  if (!ok) return;
  const failed = await runBlackout(steps);
  feed(
    failed.length
      ? { level: "alert", source: "control", title: `Blackout: ${failed.length} of ${steps.length} steps failed`, detail: failed.map((s) => s.text).join(" · "), go: { screen: "control", action: "open" } }
      : { level: "info", source: "control", title: "Blackout complete", detail: steps.map((s) => s.text).join(" · ") },
  );
}

/** What the palette commands ask for. Each needs the device list, so it waits until the list has loaded. */
async function handleIntent(intent: Intent, devices: readonly Device[], showShortcuts: (query: string) => void): Promise<void> {
  const mac = thisMac(devices);
  switch (intent.action) {
    case "awake": {
      const awake = capabilityOf(mac, "switch", "awake");
      if (!mac || !awake) return say("Keep awake is not available", "VANTAGE could not read this Mac.");
      if (awake.on) return say("This Mac is already kept awake");
      if (await act<"switch">(mac, "awake", true)) say("This Mac stays awake", "Until you switch Keep awake off or VANTAGE stops.");
      return;
    }
    case "sleep":
      if (!mac || !capabilityOf(mac, "action", "sleep-display")) return say("Sleep display is not available", "VANTAGE could not read this Mac.");
      await act<"action">(mac, "sleep-display", null);
      return;
    case "pause": {
      const playing = devices.flatMap((d) => {
        const media = capabilityOf(d, "media");
        return media?.state === "playing" ? [{ device: d, media }] : [];
      });
      if (!playing.length) return say("Nothing is playing", "Music and Spotify are paused, stopped or closed.");
      for (const { device, media } of playing) await act<"media">(device, media.id, "pause");
      return;
    }
    case "shortcut": {
      // One clear match goes straight to the confirmation; otherwise the Shortcuts panel opens filtered.
      const query = intent.arg?.trim() ?? "";
      const q = query.toLowerCase();
      for (const d of devices) {
        const c = d.kind === "automation" ? capabilityOf(d, "choice") : undefined;
        if (!c || !q) continue;
        const exact = c.options.filter((o) => o.label.toLowerCase() === q);
        const partial = c.options.filter((o) => o.label.toLowerCase().includes(q));
        const match = exact.length === 1 ? exact[0] : partial.length === 1 ? partial[0] : undefined;
        if (match) return void (await choose(d, c, match.id));
      }
      showShortcuts(query);
      document.getElementById("control-shortcuts")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    case "blackout":
      return blackout(devices);
    default:
      return;
  }
}

export default function ControlScreen(): ReactElement {
  const poll = useDevices();
  const { data } = poll;
  const devices = data?.devices ?? [];
  const selected = useControl((s) => s.selected);
  const select = useControl((s) => s.select);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [shortcutQuery, setShortcutQuery] = useState("");
  const side = useRef<HTMLDivElement>(null);
  const now = useNow(15_000);

  useIntent("control", setIntent);
  useEffect(() => {
    if (!intent || !data) return;
    setIntent(null);
    void handleIntent(intent, data.devices, setShortcutQuery);
  }, [intent, data]);

  // On a narrow screen the device panel sits under the map; bring it into view when a device is chosen.
  useEffect(() => {
    if (selected && side.current && window.matchMedia("(max-width: 1023px)").matches) side.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  const mac = thisMac(devices);
  const current = devices.find((d) => d.id === selected) ?? mac;

  return (
    <Page
      eyebrow="Control"
      title="Control"
      lede="Your Mac and the devices you own. VANTAGE controls only what discovery finds on this Mac and your own network."
      actions={
        <Button variant="danger" icon={<Power size={14} />} onClick={() => void blackout(devices)} disabled={!data}>
          Blackout
        </Button>
      }
    >
      <ConfirmHost />
      {!data ? (
        poll.error ? (
          <Empty tone="error" title="Could not read your devices" action={<Button onClick={poll.refresh}>Try again</Button>}>
            {poll.error.message}
          </Empty>
        ) : (
          <Scanning label="Reading this Mac" />
        )
      ) : (
        <>
          <div className="control-stage">
            <Panel
              title="Constellation"
              flush
              className="control-hero"
              actions={
                <div className="control-scan">
                  <span className="control-scan__status">
                    {data.scanning ? (
                      <Scanning label="Scanning your network" />
                    ) : (
                      <span className={`num${data.scanProblem ? " alarm" : " faint"}`} title={data.scanProblem ?? undefined}>
                        {data.scanProblem ? "Scan failed" : data.scannedAt ? `Scanned ${fmt.ago(data.scannedAt, now)}` : "Not scanned yet"}
                      </span>
                    )}
                  </span>
                  <Button size="sm" variant="ghost" icon={<RefreshCw size={13} />} onClick={poll.rescan} disabled={data.scanning}>
                    Rescan
                  </Button>
                </div>
              }
            >
              <Constellation devices={devices} scanning={data.scanning} />
              {data.scanProblem && <p className="control-hero__problem">{data.scanProblem}</p>}
              <div className="control-hero__stats">
                <Stat size="sm" label="On this Mac" value={devices.filter((d) => d.local).length} />
                <Stat size="sm" label="On your network" value={devices.filter((d) => !d.local).length} />
                <Stat size="sm" label="Waiting to pair" value={devices.filter((d) => d.pairing && !d.pairing.paired).length} />
                <Stat size="sm" label="Not answering" value={devices.filter((d) => !d.online).length} tone={devices.some((d) => !d.online) ? "alarm" : undefined} />
              </div>
            </Panel>
            <div ref={side} className="control-side">
              <Panel
                title={current ? current.group : "Device"}
                active
                actions={
                  current && current !== mac ? (
                    <IconButton label="Back to This Mac" onClick={() => select(null)}>
                      <ArrowLeft size={14} />
                    </IconButton>
                  ) : undefined
                }
              >
                {current ? <DevicePanel key={current.id} device={current} at={data.at} /> : <Empty title="This Mac did not answer">Reload the page. If it keeps failing, check the VANTAGE server log.</Empty>}
              </Panel>
            </div>
          </div>

          <div className="control-panels">
            <NowPlayingPanel devices={devices} at={data.at} />
            <PrintersPanel devices={devices} scanned={data.scannedAt !== null} />
            <div id="control-shortcuts" className="control-panels__wide">
              <ShortcutsPanel devices={devices} query={shortcutQuery} />
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
