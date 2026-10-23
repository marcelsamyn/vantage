import { Check, Play, Square } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { Button, Empty, Panel, Sparkline, Stat } from "../../app/ui";
import { useSpeed, type SpeedRecord } from "./client";
import { Gauge } from "./Gauge";
import type { SpeedPhase } from "./types";

const PHASES: { phase: SpeedPhase; label: string }[] = [
  { phase: "ping", label: "Ping" },
  { phase: "download", label: "Download" },
  { phase: "upload", label: "Upload" },
];

const mbps = (v: number): string => (v >= 100 ? v.toFixed(0) : v.toFixed(1));

export function SpeedTab(): ReactElement {
  const s = useSpeed();
  const running = s.status === "running";
  const last: SpeedRecord | undefined = s.history[s.history.length - 1];

  const gaugeValue = running ? (s.phase === "ping" ? 0 : s.mbps) : (s.result?.downMbps ?? 0);
  const caption = running ? (s.phase === "ping" ? "Ping" : s.phase === "upload" ? "Upload" : "Download") : s.result ? "Download" : "Ready";
  const display = running && s.phase === "ping" ? (s.pingMs !== null ? s.pingMs.toFixed(0) : "—") : undefined;

  return (
    <div className="v-grid">
      <Panel
        title="Speed test"
        actions={
          running ? (
            <Button size="sm" icon={<Square size={12} />} onClick={s.stop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<Play size={12} />} onClick={s.start}>
              {s.result || s.status === "error" ? "Run again" : "Run speed test"}
            </Button>
          )
        }
      >
        <div className="net-speed">
          <div className="net-speed__dial">
            <Gauge value={gaugeValue} caption={caption} display={display} unit={display !== undefined ? "ms" : "Mb/s"} />
            <PhaseTrack phase={s.phase} done={s.status === "done"} progress={s.progress} />
          </div>
          <div className="net-speed__results">
            {s.status === "error" ? (
              <Empty title="Speed test failed" tone="error" action={<Button onClick={s.start}>Try again</Button>}>
                {s.error}
              </Empty>
            ) : (
              <Results />
            )}
          </div>
        </div>
      </Panel>

      <History history={s.history} />
      {!last && s.status === "idle" && <p className="net-note">The test sends data to and from Cloudflare's nearest server for about a minute, using up to roughly 150 MB. Other devices on your network may slow it down.</p>}
    </div>
  );
}

function PhaseTrack({ phase, done, progress }: { phase: SpeedPhase | null; done: boolean; progress: number }): ReactElement {
  const index = phase ? PHASES.findIndex((p) => p.phase === phase) : done ? PHASES.length : -1;
  return (
    <ol className="net-phases" aria-label="Test phases">
      {PHASES.map((p, i) => {
        const state = i < index ? "done" : i === index ? "active" : "pending";
        return (
          <li key={p.phase} className={`net-phase net-phase--${state}`}>
            <span className="net-phase__mark">{state === "done" ? <Check size={11} strokeWidth={2.5} /> : i + 1}</span>
            {p.label}
          </li>
        );
      })}
      <li className="net-phases__bar" aria-hidden>
        <span style={{ width: `${Math.round((done ? 1 : progress) * 100)}%` }} />
      </li>
    </ol>
  );
}

function Results(): ReactElement {
  const s = useSpeed();
  const now = useNow(30_000);
  const last = s.history[s.history.length - 1];
  const live = s.status === "running";
  // While running, show what has been measured so far; otherwise the latest finished result.
  const down = live ? s.phaseResults.download : (s.result?.downMbps ?? last?.downMbps);
  const up = live ? s.phaseResults.upload : (s.result?.upMbps ?? last?.upMbps);
  const ping = live ? s.pingMs : (s.result?.pingMs ?? last?.pingMs);
  const jitter = live ? null : (s.result?.jitterMs ?? last?.jitterMs);
  const colo = s.result?.colo ?? last?.colo;
  const at = s.result?.at ?? last?.at;

  return (
    <div className="net-results">
      <Stat label="Download" value={down !== undefined ? mbps(down) : "—"} unit="Mb/s" size="lg" tone="ice" />
      <Stat label="Upload" value={up !== undefined ? mbps(up) : "—"} unit="Mb/s" size="lg" tone="sodium" />
      <Stat label="Ping" value={ping !== null && ping !== undefined ? ping.toFixed(0) : "—"} unit="ms" />
      <Stat label="Jitter" value={jitter !== null && jitter !== undefined ? jitter.toFixed(1) : "—"} unit="ms" />
      <div className="net-results__meta">
        {at !== undefined && !live ? `${s.result ? "Finished" : "Last result"} ${fmt.ago(at, now)}` : live ? "Measuring…" : "No result yet"}
        {colo && !live ? ` · Cloudflare ${colo}` : ""}
      </div>
    </div>
  );
}

function History({ history }: { history: SpeedRecord[] }): ReactElement {
  const rows = [...history].reverse();
  const top = Math.max(1, ...history.flatMap((h) => [h.downMbps, h.upMbps]));
  return (
    <Panel title={`History · last ${history.length || 20} results`}>
      {history.length === 0 ? (
        <Empty title="No results yet">Run the test once and your results are kept here, so you can see how your connection changes through the day.</Empty>
      ) : (
        <div className="net-history">
          <div className="net-history__chart" aria-label="Download and upload over recent tests">
            {history.length > 1 ? (
              <>
                <Sparkline values={history.map((h) => h.downMbps)} max={top} height={96} tone="ice" />
                <div className="net-history__overlay">
                  <Sparkline values={history.map((h) => h.upMbps)} max={top} height={96} tone="sodium" fill={false} />
                </div>
              </>
            ) : (
              <p className="dim">Run the test again to see a trend.</p>
            )}
            <div className="net-history__legend">
              <span className="ice">Download</span>
              <span className="sodium">Upload</span>
              <span className="faint num">scale 0 to {mbps(top)} Mb/s</span>
            </div>
          </div>
          <table className="net-history__table">
            <thead>
              <tr>
                <th>When</th>
                <th>Down</th>
                <th>Up</th>
                <th>Ping</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.at}>
                  <td>{new Date(h.at).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="ice">{mbps(h.downMbps)}</td>
                  <td className="sodium">{mbps(h.upMbps)}</td>
                  <td>{h.pingMs.toFixed(0)} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
