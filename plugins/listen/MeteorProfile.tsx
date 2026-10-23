import { Map as MapIcon } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { Button, ProfilerCard } from "../../app/ui";
import { fetchMeteorDetail, showMeteors } from "./client";
import { brightnessNote, headingOf, kmh, massComparison, massText, showerLabel, trackKm } from "./meteor-facts";

const when = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Profiler for one meteor: where it lit up and burned out, how fast, how bright, and who saw it. */
export default function MeteorProfile({ entity, onClose }: ProfilerProps<"meteor">): ReactElement {
  const m = entity.data;
  const detail = usePoll((signal) => fetchMeteorDetail(m.id, signal), null, [m.id]);
  const heading = headingOf(m);
  const stations = detail.data?.stations ?? [];

  return (
    <ProfilerCard
      key={m.id}
      band="Meteor"
      name={showerLabel(m)}
      kicker={`${when.format(m.at)} UTC · ${fmt.ago(m.at)}`}
      tone="sodium"
      onClose={onClose}
      rows={[
        detail.data?.over && ["Over", detail.data.over],
        ["Lit up", `${m.begin.heightKm.toFixed(1)} km up`],
        ["Burned out", `${m.end.heightKm.toFixed(1)} km up`],
        ["Path", `${trackKm(m).toFixed(0)} km${heading ? `, heading ${heading}` : ", almost straight down"}`],
        ["Speed", `${m.speedKms.toFixed(1)} km/s · ${fmt.int(kmh(m.speedKms))} km/h`],
        ["Lasted", `${m.durationS.toFixed(2)} s`],
        ["Brightness", `${m.peakMag.toFixed(1)} mag`],
        ["Mass", `about ${massText(m.massKg)}`],
        m.shower && ["Shower", `${m.showerName ?? "Unnamed"} · ${m.shower}`],
        ["Seen by", stations.length > 0 ? `${m.cameras} cameras · ${stations.join(", ")}` : `${m.cameras} cameras`],
        detail.error && ["Cameras", `Not listed: ${detail.error.message}`],
      ]}
      fact={`Roughly the mass of ${massComparison(m.massKg)}, it crossed ${trackKm(m).toFixed(0)} km of sky in ${m.durationS.toFixed(1)} seconds and ${brightnessNote(m.peakMag)}.`}
      actions={
        <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showMeteors({ lat: m.begin.lat, lon: m.begin.lon }, 8.5)}>
          Show on map
        </Button>
      }
      source="Global Meteor Network · CC BY 4.0 · mass is an estimate"
    />
  );
}
