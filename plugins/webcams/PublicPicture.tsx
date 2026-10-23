import { Video } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import type { ProfilerSectionProps } from "../../app/core/plugin";
import { profile } from "../../app/core/profile";
import { useSettings } from "../../app/core/settings";
import { Button } from "../../app/ui";
import { fetchCameras } from "./client";
import { Feed } from "./Feed";
import { publicPicture } from "./items";
import "./webcams.css";

/** Wide enough that the query, rounded to 0.001°, still reaches CLOSE_M on every side. */
const BOX_DEG = 0.002;
/** Directory areas that were still loading join a later answer, so the list is asked again while the profile is open. */
const RECHECK_MS = 60_000;

/**
 * The live picture of a public camera at, or right next to, a mapped surveillance camera. OpenStreetMap and the
 * operators keep separate records, so a camera nearby is named by its distance rather than taken for the same one,
 * unless both records point to one OpenStreetMap object.
 */
export default function PublicPictureSection({ entity }: ProfilerSectionProps<"grid">): ReactElement | null {
  const { kind, osm, lat, lon } = entity.data;
  const units = useSettings((s) => s.units);
  const { data, error } = usePoll(
    (signal) => fetchCameras({ west: lon - BOX_DEG, south: lat - BOX_DEG, east: lon + BOX_DEG, north: lat + BOX_DEG }, signal),
    RECHECK_MS,
    [lat, lon],
    kind !== "camera",
  );
  if (kind !== "camera") return null;
  if (!data) {
    return error ? (
      <section className="webcams-close">
        <h4 className="v-eyebrow">Public cameras here</h4>
        <p className="webcams-close__meta">The camera list did not answer: {error.message}</p>
      </section>
    ) : null;
  }
  const pick = publicPicture(data.cameras, { lat, lon }, osm);
  if (!pick) return null;
  const c = pick.camera;

  return (
    <section className="webcams-close">
      <h4 className="v-eyebrow">{pick.same ? "This camera's public picture" : `Public camera ${fmt.distance(pick.distanceM, units)} away`}</h4>
      <div className="webcams-profile__media">
        <Feed key={c.id} src={c.image} refreshS={c.refreshS} frames={c.frames} stream={c.stream} alt={`View from ${c.name}`} />
      </div>
      <p className="webcams-close__meta">
        {c.name} · {c.providerName}
      </p>
      <Button size="sm" icon={<Video size={13} />} onClick={() => profile.open({ kind: "webcam", id: c.id, data: c })}>
        Watch this camera
      </Button>
    </section>
  );
}
