import { Lock, LockOpen, MapPinOff } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { Button, Empty, Meter, Panel, Readout, Scanning, Tag } from "../../app/ui";
import { ChannelChart, type ChartNetwork } from "./ChannelChart";
import { BAND_ORDER, recommend, type Recommendation } from "./channels";
import { useWifi } from "./client";
import { bandLabel, signalQuality } from "./labels";
import type { WifiInfo, WifiNetwork } from "./types";

export function WifiTab(): ReactElement {
  const { data, error, loading, refresh } = useWifi();
  if (!data) {
    return error ? (
      <Panel>
        <Empty title="Wi-Fi report unavailable" tone="error" action={<Button onClick={refresh}>Try again</Button>}>
          {errorMessage(error)}
        </Empty>
      </Panel>
    ) : (
      <Panel>
        <Scanning label="Scanning nearby networks, about 5 s" />
      </Panel>
    );
  }
  if (data.interface === null) {
    return (
      <Panel>
        <Empty title="No Wi-Fi adapter">macOS reports no Wi-Fi hardware on this Mac. Connect with Ethernet, or check System Settings → Network.</Empty>
      </Panel>
    );
  }
  return <WifiReport info={data} refreshing={loading} onRefresh={refresh} />;
}

const describe = (n: WifiNetwork, mine: boolean): string =>
  [
    mine ? "Your network" : (n.ssid ?? "Hidden name"),
    `channel ${n.channel}`,
    `${bandLabel(n.band)}, ${n.widthMhz} MHz`,
    n.signalDbm !== null ? `${n.signalDbm} dBm` : "signal not reported",
    n.security,
    n.phy,
  ]
    .filter(Boolean)
    .join(" · ");

function WifiReport({ info, refreshing, onRefresh }: { info: WifiInfo; refreshing: boolean; onRefresh: () => void }): ReactElement {
  const [hovered, setHovered] = useState<string | null>(null);

  const chartNetworks = useMemo<ChartNetwork[]>(
    () => [...(info.current ? [{ ...info.current, id: "me", mine: true }] : []), ...info.nearby.map((n, i) => ({ ...n, id: `n${i}`, mine: false }))],
    [info],
  );
  const bands = BAND_ORDER.filter((b) => chartNetworks.some((n) => n.band === b));
  const recommendations = useMemo(() => new Map<string, Recommendation | null>(bands.map((b) => [b, recommend(b, info.nearby, info.current)])), [bands.join(), info]);
  const hoveredNetwork = chartNetworks.find((n) => n.id === hovered) ?? chartNetworks.find((n) => n.mine);
  const unreported = info.nearby.filter((n) => n.signalDbm === null).length;

  return (
    <div className="v-grid">
      <Panel
        title="Channel map"
        actions={
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Scanning…" : "Scan again"}
          </Button>
        }
      >
        {bands.length === 0 ? (
          <Empty title="No networks in range">macOS saw no Wi-Fi networks. If this Mac is joined to one, wait a few seconds and scan again.</Empty>
        ) : (
          <div className="net-charts">
            {bands.map((band) => (
              <ChannelChart key={band} band={band} networks={chartNetworks.filter((n) => n.band === band)} recommendation={recommendations.get(band) ?? null} hovered={hovered} onHover={setHovered} />
            ))}
            <div className="net-chart__caption" aria-live="polite">
              {hoveredNetwork ? describe(hoveredNetwork, hoveredNetwork.mine) : "Hover a network for details."}
            </div>
            <p className="net-note">
              Taller means a stronger signal (dBm). Wider means a wider channel. Where humps overlap, those networks share airtime.
              {unreported > 0 && ` macOS reports a signal for only some networks, so the ${unreported} without a reading are drawn short with a dashed outline.`}
            </p>
          </div>
        )}
      </Panel>

      {info.namesHidden && <NamesHidden />}

      <div className="net-columns">
        <Panel title="Your connection">
          {info.current ? <Connection net={info.current} /> : <Empty title="Not connected">This Mac is not joined to a Wi-Fi network. Pick one from the menu bar.</Empty>}
        </Panel>
        <Panel title="Least crowded channel">
          <Recommendations items={bands.map((b) => recommendations.get(b)).filter((r): r is Recommendation => !!r)} current={info.current} />
        </Panel>
      </div>

      {info.nearby.length > 0 && (
        <Panel title={`Nearby networks · ${info.nearby.length}`} flush>
          <ul>
            {[...info.nearby]
              .sort((a, b) => (b.signalDbm ?? -200) - (a.signalDbm ?? -200) || a.band.localeCompare(b.band) || a.channel - b.channel)
              .map((n, i) => (
                <li key={i} className="v-row net-nearby">
                  <span className="net-nearby__lock">{n.security === "Open" ? <LockOpen size={13} /> : <Lock size={13} />}</span>
                  <div className="v-row__main">
                    <div className="v-row__title">{n.ssid ?? <span className="dim">Hidden name</span>}</div>
                    <div className="v-row__sub">{[n.security, n.phy].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className="num dim">
                    ch {n.channel} · {bandLabel(n.band)} · {n.widthMhz} MHz
                  </span>
                  <span className="num net-nearby__signal">{n.signalDbm !== null ? `${n.signalDbm} dBm` : "—"}</span>
                </li>
              ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

function NamesHidden(): ReactElement {
  return (
    <div className="net-callout" role="note">
      <MapPinOff size={18} className="ice" />
      <div>
        <div className="net-callout__title">Network names are hidden by macOS</div>
        <p>
          macOS only shows Wi-Fi names to apps that may use your location, because names can reveal where you are. VANTAGE reads them through the terminal app that runs it. To show names:
        </p>
        <ol>
          <li>Open System Settings → Privacy &amp; Security → Location Services.</li>
          <li>Turn on the terminal app that runs VANTAGE.</li>
          <li>Restart VANTAGE.</li>
        </ol>
      </div>
    </div>
  );
}

function Connection({ net }: { net: WifiNetwork }): ReactElement {
  const quality = net.signalDbm !== null ? signalQuality(net.signalDbm) : null;
  return (
    <div className="net-stack net-stack--loose">
      <Readout
        rows={[
          ["Network", net.ssid ?? <span className="dim">Name hidden by macOS</span>],
          ["Channel", `${net.channel} · ${bandLabel(net.band)} · ${net.widthMhz} MHz`],
          net.phy && ["Standard", net.phy],
          net.security && ["Security", net.security],
          net.signalDbm !== null && ["Signal", <span key="s">{net.signalDbm} dBm {quality && <Tag tone={quality.tone}>{quality.label}</Tag>}</span>],
          net.noiseDbm !== null && ["Noise", `${net.noiseDbm} dBm`],
          net.snrDb !== null && ["Signal to noise", `${net.snrDb} dB`],
          net.txRateMbps !== null && ["Link rate", `${fmt.int(net.txRateMbps)} Mb/s`],
          net.countryCode && ["Region", net.countryCode],
        ]}
      />
      {net.signalDbm !== null && <Meter value={Math.max(0, Math.min(1, (net.signalDbm + 90) / 60))} tone={quality?.tone} ticks />}
    </div>
  );
}

function Recommendations({ items, current }: { items: Recommendation[]; current: WifiNetwork | null }): ReactElement {
  if (items.length === 0) return <Empty title="Nothing to compare">No networks were seen, so every channel is equally quiet.</Empty>;
  return (
    <ul className="net-recs">
      {items.map((r) => {
        const inUse = current?.band === r.band;
        return (
          <li key={r.band} className="net-rec">
            <div className="net-rec__band v-eyebrow">{bandLabel(r.band)}</div>
            <div className="net-rec__main">
              <span className="display net-rec__channel mint">{r.channel}</span>
              <span className="net-rec__text">
                {inUse && r.currentIsBest
                  ? `You are already on a quiet channel. ${overlapText(r.overlapping)}`
                  : inUse
                    ? `Switch from channel ${current?.channel} (${overlapText(r.currentOverlapping ?? 0)}) to channel ${r.channel} (${overlapText(r.overlapping)}), ${r.widthMhz} MHz wide.`
                    : `${overlapText(r.overlapping)} at ${r.widthMhz} MHz wide.`}
                {r.band === "5" && r.channel >= 52 && r.channel <= 144 && " Channels 52 to 144 share spectrum with weather radar, so your router may pause briefly if it detects radar."}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const overlapText = (n: number): string => (n === 0 ? "no nearby network overlaps" : `${n} nearby ${n === 1 ? "network overlaps" : "networks overlap"}`);
