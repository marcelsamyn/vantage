import { motion } from "motion/react";
import { ExternalLink, Map as MapIcon } from "lucide-react";
import { useState, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { Button, Empty, Meter, Panel, Scanning, Segmented } from "../../app/ui";
import { openMeteor, showMeteors, useMeteors } from "./client";
import { kmh, showerLabel } from "./meteor-facts";
import type { Meteor, MeteorNight } from "./types";

type Ranking = "bright" | "fast";

const RANKINGS = [
  { value: "bright", label: "Brightest" },
  { value: "fast", label: "Fastest" },
] as const satisfies readonly { value: Ranking; label: string }[];

const BRAMS_VIEWER = "https://brams.aeronomie.be/data/viewer?view=viewer";
const BRAMS_EXPLAINED = "https://brams.aeronomie.be/outreach/meteors-explained";

const utc = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
const utcClock = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", hour: "2-digit", minute: "2-digit", hour12: false });

/** Last night's meteors over Europe: how many, the brightest and fastest, which showers, and a way onto the map. */
export function Meteors(): ReactElement {
  const here = useLocation((s) => s.here);
  const { data, error, refresh } = useMeteors("europe");
  const [ranking, setRanking] = useState<Ranking>("bright");

  const body = ((): ReactElement => {
    if (error && !data) {
      return (
        <Empty title="Meteors unavailable" tone="error" action={<Button onClick={refresh}>Try again</Button>}>
          {error.message}
        </Empty>
      );
    }
    if (!data) return <Scanning label="Counting meteors" />;
    if (data.meteors.length === 0) return <Empty title="No meteors over Europe in the latest file">The Global Meteor Network publishes a new summary every few hours.</Empty>;
    return <Night data={data} ranking={ranking} onRanking={setRanking} />;
  })();

  return (
    <Panel
      title="Last night's meteors"
      className="listen-meteors"
      actions={
        <Button size="sm" variant="ghost" aria-label="Show last night's meteors on the map" icon={<MapIcon size={13} />} onClick={() => showMeteors(here ?? undefined)}>
          <span className="listen-meteors__map-label">Show on map</span>
        </Button>
      }
    >
      {body}
      <section className="listen-brams">
        <div className="v-eyebrow">Hear them with radio</div>
        <p>
          Belgium's BRAMS network listens for the echo of a distant radio beacon off the trail of each meteor. Every five minutes it publishes a spectrogram on which meteors show up as short bright streaks. Its terms for reuse are not stated, so VANTAGE links to it and does not show it here.
        </p>
        <div className="listen-brams__links">
          <a className="v-btn v-btn--sm" href={BRAMS_VIEWER} target="_blank" rel="noreferrer noopener">
            Open the BRAMS viewer <ExternalLink size={12} aria-hidden />
          </a>
          <a className="v-btn v-btn--sm v-btn--ghost" href={BRAMS_EXPLAINED} target="_blank" rel="noreferrer noopener">
            How it works
          </a>
        </div>
      </section>
      <p className="listen-footnote">Cameras of the Global Meteor Network (CC BY 4.0) record each meteor from two or more places, which gives its path and speed.</p>
    </Panel>
  );
}

function Night({ data, ranking, onRanking }: { data: MeteorNight; ranking: Ranking; onRanking: (r: Ranking) => void }): ReactElement {
  const ranked = [...data.meteors].sort((a, b) => (ranking === "bright" ? a.peakMag - b.peakMag : b.speedKms - a.speedKms)).slice(0, 6);
  const topShower = data.showers[0]?.count ?? 1;
  return (
    <>
      <div className="listen-meteors__stats">
        <div className="listen-bignum">
          <div className="v-eyebrow">Seen over Europe</div>
          <div className="listen-bignum__value display num sodium">{fmt.int(data.meteors.length)}</div>
          <div className="listen-bignum__hint num">
            {utc.format(data.from)} to {utc.format(data.to)} UTC
          </div>
          <div className="listen-bignum__hint num">
            Newest {fmt.ago(data.to)} · {fmt.int(data.total)} worldwide
          </div>
        </div>
        <div className="listen-meteors__records">
          {data.brightest && <Record label="Brightest" meteor={data.brightest} value={`${data.brightest.peakMag.toFixed(1)}`} unit="mag" />}
          {data.fastest && <Record label="Fastest" meteor={data.fastest} value={data.fastest.speedKms.toFixed(0)} unit="km/s" />}
        </div>
      </div>

      {data.showers.length > 0 && (
        <ul className="listen-showers" aria-label="Showers seen over Europe">
          {data.showers.slice(0, 5).map((s, i) => (
            <motion.li key={s.code} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05, type: "spring", duration: 0.45, bounce: 0 }}>
              <span className="listen-showers__name">{s.name}</span>
              <Meter value={s.count} max={topShower} tone="sodium" />
              <span className="num dim listen-showers__count">{s.count}</span>
            </motion.li>
          ))}
        </ul>
      )}

      <div className="listen-meteors__rank">
        <Segmented label="Rank meteors by" value={ranking} options={RANKINGS} onChange={onRanking} />
      </div>
      <ul className="listen-meteor-list">
        {ranked.map((m) => (
          <li key={m.id}>
            <button type="button" className="v-row listen-meteor-row" onClick={() => openMeteor(m)}>
              <span className="num dim listen-meteor-row__time">{utcClock.format(m.at)}</span>
              <span className="v-row__main">
                <span className="v-row__title">{showerLabel(m)}</span>
                <span className="v-row__sub">
                  {m.begin.heightKm.toFixed(0)} to {m.end.heightKm.toFixed(0)} km up · seen by {m.cameras} cameras
                </span>
              </span>
              <span className="num sodium">{ranking === "bright" ? `${m.peakMag.toFixed(1)} mag` : `${m.speedKms.toFixed(0)} km/s`}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function Record({ label, meteor, value, unit }: { label: string; meteor: Meteor; value: string; unit: string }): ReactElement {
  return (
    <button type="button" className="listen-record" onClick={() => openMeteor(meteor)} aria-label={`${label}: ${value} ${unit}, ${showerLabel(meteor)}. Open its profile`}>
      <span className="v-eyebrow">{label}</span>
      <span className="listen-record__value display num">
        {value}
        <span className="v-stat__unit">{unit}</span>
      </span>
      <span className="listen-record__hint">
        {showerLabel(meteor)}
        {label === "Fastest" ? ` · ${fmt.int(kmh(meteor.speedKms))} km/h` : ` · ${meteor.begin.heightKm.toFixed(0)} km up`}
      </span>
    </button>
  );
}
