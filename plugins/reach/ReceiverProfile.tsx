import { ExternalLink, Radio } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, Meter, ProfilerCard, Tag } from "../../app/ui";
import { compassPoint, bearingDeg, distanceM } from "../../shared/geo";
import { formatBand, useReceivers } from "./client";
import { tuneIn } from "./store";
import { isFull, slotsFree } from "./types";

/** Profile of one public radio receiver: where it stands, what it hears, and how many seats are taken. */
export default function ReceiverProfile({ entity, onClose }: ProfilerProps<"receiver">): ReactElement {
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  // The receiver reports its listeners to KiwiSDR.com every few minutes; follow the newest list.
  const live = useReceivers().data?.receivers.find((r) => r.id === entity.id);
  const r = live ?? entity.data;
  const full = isFull(r);
  const free = slotsFree(r);
  const web = r.kind === "websdr";

  return (
    <ProfilerCard
      key={r.id}
      band={full ? "Radio receiver · full" : "Radio receiver · open"}
      tone={full ? "ice" : "sodium"}
      name={r.name}
      kicker={r.place ?? "Receiver"}
      onClose={onClose}
      rows={[
        r.antenna && ["Antenna", r.antenna],
        ["Hears", formatBand(r.minHz, r.maxHz)],
        ["Listeners", r.slots === null || r.users === null ? "Not reported, no seat limit" : `${r.users} of ${r.slots} slots`],
        here && ["From you", `${fmt.distance(distanceM(here, r), units)} ${compassPoint(bearingDeg(here, r))}`],
        ["Position", fmt.coord(r.lat, r.lon)],
        ["Software", web ? "WebSDR" : "KiwiSDR"],
      ]}
      fact={
        full
          ? `All ${r.slots} slots are taken. Each slot is a separate tuner, so you can join as soon as someone leaves.`
          : web
            ? "A WebSDR digitises a whole stretch of the radio spectrum at once, so any number of listeners can each tune their own channel from the same antenna."
            : "One antenna feeds the whole shortwave band to everyone connected, and each listener tunes a private channel of their own."
      }
      actions={
        <>
          <Button size="sm" variant="primary" icon={<Radio size={13} />} disabled={full} title={full ? "Every slot is in use right now" : "Open the receiver in a panel on the Reach screen"} onClick={() => tuneIn(r)}>
            Tune in
          </Button>
          <a className="v-btn v-btn--sm v-btn--ghost" href={r.url} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={13} /> Its own page
          </a>
        </>
      }
      source={web ? "WebSDR, University of Twente" : "KiwiSDR.com list"}
    >
      {r.slots !== null && r.users !== null && (
        <div className="reach-slots">
          <div className="reach-slots__head">
            <span className="v-eyebrow">Slots</span>
            <Tag tone={full ? "alarm" : "mint"}>{full ? "Full" : `${free} free`}</Tag>
          </div>
          <Meter value={r.users} max={r.slots} ticks tone={full ? "alarm" : "sodium"} />
        </div>
      )}
    </ProfilerCard>
  );
}
