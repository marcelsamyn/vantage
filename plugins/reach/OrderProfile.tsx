import { ExternalLink, Megaphone } from "lucide-react";
import type { ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard, Tag } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { fetchReportLink } from "./client";

/**
 * Profile of one open report to a city. The report text has already had names and contact details removed on the
 * server, and the person who filed it is never shown.
 */
export default function OrderProfile({ entity, onClose }: ProfilerProps<"workorder">): ReactElement {
  const o = entity.data;
  const units = useSettings((s) => s.units);
  const here = useLocation((s) => s.here);
  const link = usePoll((signal) => fetchReportLink(o, signal), null, [o.id]);

  return (
    <ProfilerCard
      key={o.id}
      band="Work order"
      name={o.category}
      kicker={o.authority ?? o.operator}
      media={o.photo}
      onClose={onClose}
      rows={[
        ["Status", o.status === "acknowledged" ? "Acknowledged by the city" : "Open, not yet fixed"],
        ["Reported", fmt.ago(o.createdAt)],
        o.description && ["What was said", o.description],
        here && ["From you", `${fmt.distance(distanceM(here, o), units)} ${compassPoint(bearingDeg(here, o))}`],
        ["Position", fmt.coord(o.lat, o.lon)],
        ["Held by", o.operator],
      ]}
      fact="Check the operator's site to see whether someone already filed the same problem before you add yours."
      actions={
        <>
          {link.data ? (
            <a className="v-btn v-btn--sm v-btn--primary" href={link.data.url} target="_blank" rel="noreferrer noopener" title={`Opens ${link.data.operator} at this spot. You send the report there.`}>
              <Megaphone size={13} /> Report a problem here
            </a>
          ) : (
            <Button size="sm" variant="primary" icon={<Megaphone size={13} />} disabled title={link.loading ? "Finding the reporting page" : "No reporting service is known for this spot"}>
              {link.loading ? "Finding the page…" : "No page found"}
            </Button>
          )}
          <a className="v-btn v-btn--sm v-btn--ghost" href={o.url} target="_blank" rel="noreferrer noopener">
            <ExternalLink size={13} /> This report
          </a>
        </>
      }
      source={`${o.operator} · you submit on their site, VANTAGE sends nothing`}
    >
      <div className="reach-tags">
        <Tag tone={o.status === "acknowledged" ? "mint" : undefined}>{o.status === "acknowledged" ? "Acknowledged" : "Open"}</Tag>
        {link.data && <Tag>{link.data.operator}</Tag>}
      </div>
    </ProfilerCard>
  );
}
