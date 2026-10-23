import { Radio } from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useStoredState } from "../../app/core/hooks";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, Panel, Scanning, Segmented, Tag } from "../../app/ui";
import { distanceM, type LatLon } from "../../shared/geo";
import { hearFrom, receiverIsFree } from "./client";
import { tuneIn } from "./store";
import { BEACONS, covers, slotsFree, type Receiver } from "./types";

const HALF_EARTH_M = 20_015_000;

/** One shortwave signal, with the free receivers that cover it: the nearest to you first, then others out to the farthest. */
export function HearSection({ receivers, here, error }: { receivers: readonly Receiver[] | undefined; here: LatLon | null; error: string | null }): ReactElement {
  const units = useSettings((s) => s.units);
  const [beaconId, setBeaconId] = useStoredState("reach:beacon", BEACONS[0]?.id ?? "wwv10");
  const [all, setAll] = useState(false);
  const beacon = BEACONS.find((b) => b.id === beaconId) ?? BEACONS[0];

  const origin = here ?? beacon?.at ?? null;
  const rows = useMemo(() => (receivers && beacon && origin ? hearFrom(receivers, beacon, origin, all ? 8 : 4, all ? 8 : 4) : null), [receivers, beacon, origin, all]);
  const coverage = useMemo(() => (receivers && beacon ? receivers.filter((r) => covers(r, beacon.kHz)) : null), [receivers, beacon]);
  const free = coverage?.filter(receiverIsFree).length ?? 0;

  if (!beacon) return <></>;
  const freq = beacon.kHz < 1000 ? `${beacon.kHz} kHz` : `${beacon.kHz / 1000} MHz`;

  return (
    <Panel title="Hear one station from many places">
      <div className="reach-hear__pick">
        <Segmented label="Station" value={beacon.id} onChange={setBeaconId} options={BEACONS.map((b) => ({ value: b.id, label: b.label }))} />
      </div>
      <div className="reach-hear__lede">
        <p>
          <strong>{beacon.label}</strong> is {beacon.about}, sent by {beacon.operator} from {beacon.from}. {coverage ? `${fmt.int(coverage.length)} receivers cover ${freq}, and ${fmt.int(free)} of them are free.` : ""} Tune a near receiver and a far one in turn: the same signal arrives with a different strength from each.
        </p>
        {!here && beacon.at && <p className="reach-hear__hint">Distances are measured from the transmitter until VANTAGE knows where you are.</p>}
      </div>
      {!origin ? (
        <Empty title="Waiting for your location">This signal's transmitter has no published position, so distances need yours. Allow location access, or pick another station.</Empty>
      ) : rows ? (
        rows.length === 0 ? (
          <Empty title="No free receiver covers this signal">Every receiver that reaches {freq} is full right now, or none reaches that low. Try another station, or check again in a few minutes.</Empty>
        ) : (
          <ul className="reach-hear">
            {rows.map(({ item: r, distanceM: d }, i) => (
              <li key={r.id} className="reach-hear__row">
                <div className="reach-hear__main">
                  <div className="reach-hear__name">{r.name}</div>
                  <div className="reach-hear__sub">
                    {[r.place ?? r.antenna ?? "Receiver", here && beacon.at ? `${fmt.distance(distanceM(r, beacon.at), units)} from the transmitter` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="reach-hear__path" aria-hidden>
                  <span className="reach-hear__bar" style={{ width: `${Math.max(2, (d / HALF_EARTH_M) * 100)}%` }} />
                </div>
                <div className="reach-hear__dist num">
                  {fmt.distance(d, units)}
                  <span className="reach-hear__from">{here ? "from you" : "from the transmitter"}</span>
                </div>
                <Tag tone="mint">{slotsFree(r) === null ? "No limit" : `${slotsFree(r)} free`}</Tag>
                <Button size="sm" variant={i === 0 ? "primary" : "default"} icon={<Radio size={13} />} onClick={() => tuneIn(r, beacon)}>
                  Tune in
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : error ? (
        <Empty title="Receiver list unavailable" tone="error">
          {error}
        </Empty>
      ) : (
        <Scanning label="Loading receivers" />
      )}
      {rows && rows.length > 0 && (
        <div className="reach-hear__more">
          <Button size="sm" variant="ghost" onClick={() => setAll(!all)}>
            {all ? "Show fewer" : "Show more receivers"}
          </Button>
        </div>
      )}
    </Panel>
  );
}
