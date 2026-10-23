import { ExternalLink } from "lucide-react";
import { useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { ProfilerCard, Scanning, Segmented } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { fetchSeismo, formatVelocity, tntTonnes } from "./client";
import { VOLCANOES } from "./seismo";
import { Seismograph } from "./Seismograph";
import type { Quake } from "./types";
import { VolcanoPanel } from "./VolcanoPanel";
import "./hazards.css";

const SOURCE_NAME = { USGS: "U.S. Geological Survey", EMSC: "Euro-Mediterranean Seismological Centre", INGV: "Istituto Nazionale di Geofisica e Vulcanologia" } as const;
const FOURTEEN_DAYS = 14 * 86_400_000;

function energy(mag: number): string {
  const t = tntTonnes(mag);
  if (t >= 1e6) return `${fmt.one(t / 1e6)} million tonnes of TNT`;
  if (t >= 1e3) return `${fmt.int(t / 1e3)} thousand tonnes of TNT`;
  if (t >= 1) return `${fmt.int(t)} tonnes of TNT`;
  if (t >= 0.001) return `${fmt.int(t * 1000)} kilograms of TNT`;
  return `${fmt.int(t * 1e6)} grams of TNT`;
}

/** Profiler for an earthquake: how strong, how deep, how far, how much energy it released, and what the nearest seismograph recorded. */
export default function QuakeProfile({ entity, onClose }: ProfilerProps<"quake">): ReactElement {
  const q = entity.data;
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(30_000);
  const shallow = q.depthKm < 70;
  const sources = [q.source, ...q.alsoIn].join(", ");
  return (
    <ProfilerCard
      band="Earthquake"
      tone="alarm"
      name={`M ${q.mag.toFixed(1)}`}
      kicker={q.place}
      onClose={onClose}
      rows={[
        ["When", `${new Date(q.time).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · ${fmt.ago(q.time, now)}`],
        ["Depth", `${fmt.one(q.depthKm)} km${shallow ? " · shallow" : ""}`],
        ["Magnitude", `${q.mag.toFixed(1)} ${q.magType}`.trim()],
        q.mmi !== null && ["Shaking", `Intensity ${fmt.one(q.mmi)} (Mercalli)`],
        q.felt !== null && ["Felt reports", fmt.int(q.felt)],
        q.alert && ["Impact alert", `PAGER ${q.alert}`],
        q.tsunami && ["Tsunami", "Possible: check official warnings"],
        here && ["From you", `${fmt.distance(distanceM(here, q), units)} ${compassPoint(bearingDeg(here, q))}`],
        q.reviewed !== null && ["Status", q.reviewed ? "Reviewed by a seismologist" : "Automatic, may change"],
        ["Reported by", sources],
      ]}
      fact={`It released roughly as much energy as ${energy(q.mag)}. ${shallow ? "Shallow quakes like this one shake the surface harder than deep ones." : "At this depth, shaking at the surface is weaker than the magnitude suggests."}`}
      actions={
        <a className="v-btn v-btn--sm v-btn--ghost" href={q.url} target="_blank" rel="noreferrer">
          <ExternalLink size={13} /> {q.source} event page
        </a>
      }
      source={SOURCE_NAME[q.source]}
    >
      {now - q.time < FOURTEEN_DAYS && <QuakeTrace quake={q} />}
    </ProfilerCard>
  );
}

/** Volcano seismographs are offered for quakes within this distance of one of Italy's three monitored volcanoes. */
const VOLCANO_RANGE_M = 1_000_000;

type TraceMode = "nearest" | "volcanoes";

/** What the public seismic station nearest the epicentre recorded around the quake, or what the volcanoes were doing at that moment. */
function QuakeTrace({ quake }: { quake: Quake }): ReactElement {
  const [mode, setMode] = useState<TraceMode>("nearest");
  const nearVolcanoes = VOLCANOES.some((v) => distanceM(v.summit, quake) < VOLCANO_RANGE_M);
  return (
    <div className="hazards-trace">
      <div className="hazards-trace__head">
        <div className="v-eyebrow">{mode === "nearest" ? "Nearest seismograph" : "Did the volcanoes feel it?"}</div>
        {nearVolcanoes && (
          <Segmented
            label="Which seismographs to show"
            value={mode}
            options={[
              { value: "nearest", label: "Nearest" },
              { value: "volcanoes", label: "Volcanoes" },
            ]}
            onChange={setMode}
          />
        )}
      </div>
      {mode === "volcanoes" ? <VolcanoPanel moment={quake.time} /> : <NearestTrace quake={quake} />}
    </div>
  );
}

function NearestTrace({ quake }: { quake: Quake }): ReactElement {
  const { data, error, loading } = usePoll((signal) => fetchSeismo(quake, quake.time, signal), null, [quake.id]);
  const units = useSettings((s) => s.units);
  if (data) {
    return (
      <>
        <Seismograph trace={data} live={false} height={72} markMs={quake.time} />
        <div className="hazards-trace__note">
          {data.station.id} ({data.station.operator}), {fmt.distance(data.station.distanceKm * 1000, units)} from the epicentre. The red line marks the origin time; peak ground speed {formatVelocity(data.peakNmS)}.
          {quake.mag < 3 && data.station.distanceKm > 50 ? " A quake this small is often too weak to show at a station this far away." : ""}
        </div>
      </>
    );
  }
  return loading ? <Scanning label="Fetching the recording" /> : <div className="hazards-trace__note">{error?.message ?? "No recording found."}</div>;
}
