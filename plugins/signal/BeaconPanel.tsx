import type { ReactElement } from "react";
import { Button, Empty, LiveDot, Meter, Panel, Sparkline, Tag } from "../../app/ui";
import { fmt } from "../../app/core/format";
import { CONFIRM_MS } from "./tracker";
import type { Snapshot } from "./types";

export const BAND_FROM_HZ = 17_500;
export const BAND_TO_HZ = 21_000;
/** Prominence at which the strength meter is full. */
const METER_FULL_DB = 40;

const kHz = (hz: number): string => `${(hz / 1000).toFixed(2)} kHz`;

export function BeaconPanel({ snap, onClear, active }: { snap: Snapshot | null; onClear: () => void; active: boolean }): ReactElement {
  const band = snap?.band;
  const blind = snap !== null && band !== undefined && band.reachHz === 0;
  const detected = snap?.beaconActive === true;
  const tone = detected ? "alarm" : "ice";
  const log = snap?.beacons ?? [];

  return (
    <Panel
      title="Beacon watch"
      active={active}
      actions={
        <Tag tone={detected ? "alarm" : undefined}>
          {snap && !blind && <LiveDot tone={detected ? "alarm" : "ice"} />}
          {detected ? "Tone sounding" : blind ? "Out of range" : snap ? "Watching" : "Idle"}
        </Tag>
      }
    >
      <div className="signal-beacons">
        <p className="signal-note dim">
          Some apps, TV ads and shops play a quiet tone above 17.5 kHz that other devices pick up, to link phones across a room. This watches {kHz(BAND_FROM_HZ)} to {kHz(BAND_TO_HZ)} for narrow tones that stand well above the background and last {fmt.one(CONFIRM_MS / 1000)} s or more.
        </p>

        <div className="signal-beacons__band">
          <Sparkline values={band?.shape ?? []} min={-110} max={-30} height={56} tone={tone} />
          <div className="signal-beacons__axis" aria-hidden>
            <span>{BAND_FROM_HZ / 1000} kHz</span>
            <span>{band && band.reachHz > 0 && band.reachHz < BAND_TO_HZ ? `${(band.reachHz / 1000).toFixed(1)} kHz is this source's limit` : `${BAND_TO_HZ / 1000} kHz`}</span>
          </div>
        </div>

        <div className="signal-beacons__meter">
          <div className="signal-beacons__meter-row">
            <span className="v-eyebrow">Tone strength</span>
            <span className="num dim">{band && band.prominence > 0 ? `+${band.prominence.toFixed(0)} dB above the band` : "no narrow tone"}</span>
          </div>
          <Meter value={band?.prominence ?? 0} max={METER_FULL_DB} tone={tone} ticks />
          <div className="num dim signal-beacons__peak">{band && band.peakHz !== null ? `Loudest in band: ${band.peakDb.toFixed(0)} dBFS at ${kHz(band.peakHz)}` : "Loudest in band: —"}</div>
        </div>

        {blind && (
          <p className="signal-note signal-note--warn">This source is sampled at {fmt.one((snap?.sampleRate ?? 0) / 1000)} kHz, so it cannot carry anything above {fmt.one((snap?.sampleRate ?? 0) / 2000)} kHz. Beacon watch cannot see this band.</p>
        )}

        <div className="signal-beacons__log">
          <div className="signal-beacons__log-head">
            <span className="v-eyebrow">Detections</span>
            {log.length > 0 && (
              <Button size="sm" variant="ghost" onClick={onClear}>
                Clear
              </Button>
            )}
          </div>
          {log.length === 0 ? (
            <Empty title="Nothing detected">A beacon-like tone has to hold one frequency for {fmt.one(CONFIRM_MS / 1000)} s. Short blips, speech and music are ignored.</Empty>
          ) : (
            <table className="signal-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Frequency</th>
                  <th>Duration</th>
                  <th>Peak</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 8).map((e) => (
                  <tr key={e.id} data-ongoing={e.ongoing}>
                    <td>{fmt.clock(e.startedAt, true)}</td>
                    <td>{kHz(e.frequency)}</td>
                    <td>{e.ongoing ? `${(e.durationMs / 1000).toFixed(1)} s…` : `${(e.durationMs / 1000).toFixed(1)} s`}</td>
                    <td>{e.peakDb.toFixed(0)} dB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="signal-note dim">
          Many laptop microphones roll off above about 18 kHz, so a quiet band does not prove nothing is there. A positive result is a hint, not proof: a nearby device, a screen or a fan can also whine at these frequencies.
        </p>
      </div>
    </Panel>
  );
}
