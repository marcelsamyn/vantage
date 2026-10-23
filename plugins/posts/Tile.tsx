import { Map as MapIcon } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { useTileEmpty } from "../../app/core/tile";
import { Button, Empty, Scanning, Stat } from "../../app/ui";
import { showLayer } from "../city/client";
import { fetchNear } from "./client";
import { GROUP_LOOK } from "./look";
import type { NearSummary, Tally } from "./types";
import "./posts.css";

const value = (t: Tally): string => (t.ok ? `${fmt.int(t.count)}${t.capped ? "+" : ""}` : "–");
const isZero = (t: Tally | null): boolean => t === null || (t.ok && t.count === 0);
const nothingNear = (d: NearSummary): boolean => isZero(d.sightings) && isZero(d.reports) && isZero(d.videos) && isZero(d.photos);

/** Briefing tile: how many posts people made near you lately, and the newest sighting's photo. */
export default function PostsTile(): ReactElement {
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(60_000);
  const spot = here ? `${here.lat.toFixed(2)},${here.lon.toFixed(2)}` : null;
  const near = usePoll((signal) => (here ? fetchNear(here, signal) : Promise.reject(new Error("No location yet"))), 3 * 60_000, [spot], !here);
  useTileEmpty(near.data ? nothingNear(near.data) : false);

  if (!here) return <Scanning label="Waiting for your location" />;
  if (near.error && !near.data) {
    return (
      <Empty title="Posts are unavailable" tone="error">
        {near.error.message}
      </Empty>
    );
  }
  const d = near.data;
  if (!d) return <Scanning label="Reading posts near you" />;

  const newest = d.newest;
  const errors = [d.sightings, d.reports, d.videos, d.photos].flatMap((t) => (t && !t.ok ? [t.error] : []));
  return (
    <div className="posts-tile">
      <div className="posts-tile__stats">
        <Stat label="Sightings, 24 h" value={value(d.sightings)} tone="sodium" size="sm" hint={`within ${fmt.distance(d.radiusKm * 1000, units)}`} />
        <Stat label="Reports, 7 days" value={d.reports ? value(d.reports) : "–"} size="sm" hint={d.reports ? "Fix My Street" : "Brussels region only"} />
        {d.videos && <Stat label="Live streams now" value={value(d.videos)} size="sm" hint="YouTube" />}
        {d.photos && <Stat label="Photos, 24 h" value={value(d.photos)} size="sm" hint="Flickr" />}
      </div>
      {newest?.photo && (
        <button type="button" className="posts-tile__newest" onClick={() => profile.open({ kind: "post", id: newest.id, data: newest })}>
          <img src={newest.photo.thumb} alt="" loading="lazy" style={{ borderColor: GROUP_LOOK[newest.kind].ink }} />
          <span className="posts-tile__what">
            <span className="v-eyebrow">Newest sighting</span>
            <span className="posts-tile__name">{newest.title}</span>
            <span className="v-stat__hint">
              {GROUP_LOOK[newest.kind].label} · posted {fmt.ago(Date.parse(newest.postedAt), now)}
            </span>
          </span>
        </button>
      )}
      {errors.length > 0 && <p className="v-stat__hint posts-tile__error">{errors.join(" ")}</p>}
      <Button size="sm" variant="ghost" icon={<MapIcon size={13} />} onClick={() => showLayer("posts.sightings")}>
        Show on the map
      </Button>
    </div>
  );
}
