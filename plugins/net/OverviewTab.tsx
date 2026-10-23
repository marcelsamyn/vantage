import { ArrowDown, ArrowUp } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { errorMessage } from "../../app/core/api";
import { go } from "../../app/core/nav";
import { Button, Empty, LiveDot, Meter, Panel, Readout, Scanning, Stat, Tag } from "../../app/ui";
import { useOverview, useThroughput } from "./client";
import { bandLabel, rateParts, signalQuality } from "./labels";
import { Scope } from "./Scope";
import type { NetOverview } from "./types";

export function OverviewTab(): ReactElement {
  return (
    <div className="v-grid">
      <Throughput />
      <Details />
    </div>
  );
}

function Throughput(): ReactElement {
  const { samples, online, primary, error } = useThroughput(1_000);
  const last = samples[samples.length - 1];
  const peak = samples.filter((s) => Date.now() - s.at <= 60_000).reduce((m, s) => ({ down: Math.max(m.down, s.down), up: Math.max(m.up, s.up) }), { down: 0, up: 0 });
  const down = rateParts(last?.down ?? 0);
  const up = rateParts(last?.up ?? 0);

  return (
    <Panel
      title="Live throughput"
      actions={
        <span className="net-live">
          <LiveDot tone={online ? "mint" : "alarm"} live={online} />
          {online ? (primary ?? "") : "offline"}
        </span>
      }
    >
      <div className="net-hero">
        <div className="net-values">
          <div className="net-value net-value--down">
            <Stat label={<span className="net-label"><ArrowDown size={11} /> Download</span>} value={down.value} unit={down.unit} size="lg" tone="ice" hint={`peak ${fmt.bitsPerSecond(peak.down)}`} />
          </div>
          <div className="net-value net-value--up">
            <Stat label={<span className="net-label"><ArrowUp size={11} /> Upload</span>} value={up.value} unit={up.unit} size="lg" tone="sodium" hint={`peak ${fmt.bitsPerSecond(peak.up)}`} />
          </div>
        </div>
        <div className="net-scope-wrap">
          <Scope />
          {!online && (
            <div className="net-scope-note">
              <Empty title="No connection" tone="error">
                {error ?? "This Mac has no default network route. Connect to Wi-Fi or Ethernet and the trace resumes."}
              </Empty>
            </div>
          )}
          {online && samples.length < 2 && (
            <div className="net-scope-note">
              <Scanning label="Measuring" />
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function Details(): ReactElement {
  const { data, error } = useOverview();
  if (!data) {
    return error ? (
      <Panel>
        <Empty title="Network details unavailable" tone="error">
          {errorMessage(error)}
        </Empty>
      </Panel>
    ) : (
      <Panel>
        <Scanning label="Reading network" />
      </Panel>
    );
  }
  return (
    <div className="net-columns">
      <Connection data={data} />
      <WifiBrief data={data} />
      <Interfaces data={data} />
    </div>
  );
}

function Connection({ data }: { data: NetOverview }): ReactElement {
  const inUse = data.interfaces.find((i) => i.isDefault);
  return (
    <Panel title="Connection">
      {data.gateway.ip ? (
        <Readout
          rows={[
            ["Computer", data.hostname],
            ["Connected via", inUse ? `${inUse.label} (${inUse.name})` : (data.gateway.interface ?? "Unknown")],
            ["Gateway", data.gateway.ip],
            [
              "DNS",
              data.dns.servers.length ? (
                <span className="net-stack">
                  {data.dns.servers.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </span>
              ) : (
                "None configured"
              ),
            ],
          ]}
        />
      ) : (
        <Empty title="Not connected">This Mac has no default route. Join a Wi-Fi network or plug in an Ethernet cable.</Empty>
      )}
    </Panel>
  );
}

function WifiBrief({ data }: { data: NetOverview }): ReactElement {
  const w = data.wifi;
  return (
    <Panel
      title="Wi-Fi"
      actions={
        <Button size="sm" variant="ghost" onClick={() => go("net", { action: "wifi" })}>
          Analyse channels
        </Button>
      }
    >
      {w ? (
        <div className="net-stack net-stack--loose">
          <Readout
            rows={[
              ["Network", w.ssid ?? <span className="dim">Name hidden by macOS</span>],
              ["Channel", `${w.channel} · ${bandLabel(w.band)} · ${w.widthMhz} MHz`],
              w.signalDbm !== null && ["Signal", `${w.signalDbm} dBm · ${signalQuality(w.signalDbm).label}`],
              w.snrDb !== null && ["Signal to noise", `${w.snrDb} dB`],
              w.txRateMbps !== null && ["Link rate", `${fmt.int(w.txRateMbps)} Mb/s`],
            ]}
          />
          {w.signalDbm !== null && <Meter value={Math.max(0, Math.min(1, (w.signalDbm + 90) / 60))} tone={signalQuality(w.signalDbm).tone} ticks />}
        </div>
      ) : data.wifiPending ? (
        <Scanning label="Reading Wi-Fi, about 5 s" />
      ) : (
        <Empty title="No Wi-Fi link">This Mac is not joined to a Wi-Fi network, or it has no Wi-Fi adapter.</Empty>
      )}
    </Panel>
  );
}

function Interfaces({ data }: { data: NetOverview }): ReactElement {
  return (
    <Panel title="Interfaces" flush>
      {data.interfaces.length === 0 ? (
        <Empty title="No active interfaces">None of this Mac's network interfaces has an address.</Empty>
      ) : (
        <ul>
          {data.interfaces.map((i) => (
            <li key={i.name} className="v-row net-iface">
              <div className="v-row__main">
                <div className="v-row__title">
                  {i.label} <span className="faint num">{i.name}</span>
                </div>
                <div className="v-row__sub">{[...i.ipv4, ...i.ipv6.slice(0, 1)].join(" · ") || "No address"}</div>
                {i.mac && <div className="v-row__sub">{i.mac}</div>}
              </div>
              {i.isDefault && <Tag tone="ice">In use</Tag>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
