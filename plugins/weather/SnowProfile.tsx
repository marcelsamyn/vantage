import { Map as MapIcon } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings, type Units } from "../../app/core/settings";
import { Button, Empty, ProfilerCard, Scanning, Tag } from "../../app/ui";
import { showLayer } from "../city/client";
import { fetchSnowHistory, temp1 } from "./client";
import { SnowChart } from "./SnowChart";
import "./weather.css";

const temp = (c: number | null | undefined, units: Units): string | null => (c == null ? null : temp1(c, units));

/** Profiler for an Alpine snow station: the last seven days of snow depth and what the snow is like inside. */
export default function SnowProfile({ entity, onClose }: ProfilerProps<"snowstation">): ReactElement {
  const s = entity.data;
  const units = useSettings((st) => st.units);
  const { data, error } = usePoll((signal) => fetchSnowHistory(s.code, signal), 10 * 60_000, [s.code]);
  const pack = data?.snowpack;
  const live = data?.station ?? s;

  return (
    <ProfilerCard
      key={s.code}
      band={live.fresh ? "Snow station · fresh snow" : "Snow station"}
      tone="sodium"
      name={s.name}
      kicker={`${fmt.int(s.elevationM)} m · ${s.canton ?? s.country}, ${s.country === "LI" ? "Liechtenstein" : "Switzerland"}`}
      onClose={onClose}
      rows={[
        ["Snow depth", `${live.depthCm.toFixed(live.depthCm < 10 ? 1 : 0)} cm`],
        ["Last six hours", live.fresh ? <Tag key="f" tone="sodium">{`Fresh snow · up ${fmt.one(live.riseCm)} cm`}</Tag> : live.riseCm > 0 ? `Up ${fmt.one(live.riseCm)} cm` : "No rise"],
        ["Air", temp(live.airC, units)],
        pack?.surfaceC != null && ["Snow surface", temp(pack.surfaceC, units)],
        pack?.at25cmC != null && ["Inside, 25 cm up", temp(pack.at25cmC, units)],
        pack?.at50cmC != null && ["Inside, 50 cm up", temp(pack.at50cmC, units)],
        pack?.at100cmC != null && ["Inside, 100 cm up", temp(pack.at100cmC, units)],
        ["Reading", `${fmt.clock(Date.parse(live.at))} · every 30 minutes`],
      ]}
      fact={
        live.fresh
          ? "It is snowing, or just has. Early in the season a sensor's depth wanders by a few centimetres, so VANTAGE calls snow fresh only when the depth rises 5 cm or more within six hours."
          : "Snow depth is the height of the snow above the ground at one pole. Early in the season it can swing by a few centimetres between readings, so one reading proves little."
      }
      actions={
        <Button size="sm" icon={<MapIcon size={13} />} onClick={() => showLayer("weather.snow")}>
          Show on map
        </Button>
      }
      source="WSL Institute for Snow and Avalanche Research SLF, IMIS network · CC BY 4.0"
    >
      <div className="weather-snow">
        <h4 className="v-eyebrow weather-snow__title">Snow depth · 7 days</h4>
        {data ? <SnowChart series={data.series} fresh={live.fresh} /> : error ? <Empty title="History unavailable" tone="error">{error.message}</Empty> : <Scanning label="Reading the station" />}
      </div>
    </ProfilerCard>
  );
}
