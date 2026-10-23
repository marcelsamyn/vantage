import { ExternalLink, Play } from "lucide-react";
import { useState, type ReactElement, type ReactNode } from "react";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import type { ProfilerProps } from "../../app/core/plugin";
import { useSettings } from "../../app/core/settings";
import { Button, ProfilerCard, Readout, Scramble, Tag, type MaybeRow } from "../../app/ui";
import { bearingDeg, compassPoint, distanceM } from "../../shared/geo";
import { GROUP_LOOK, STATUS_LOOK } from "./look";
import type { LiveStream, PhotoPost, Post, PostAuthor, PostPhoto, Sighting, StreetReport } from "./types";
import { describeWhen } from "./when";
import "./posts.css";

const QUALITY: Record<Sighting["detail"]["quality"], string> = {
  research: "Research grade: the community agrees on the species",
  needs_id: "Needs ID: not yet confirmed by others",
  casual: "Casual: missing details, or not wild",
};

/** One post: what was posted, where, when and by whom, as far as the source says. */
export default function PostProfile({ entity, onClose }: ProfilerProps<"post">): ReactElement {
  const post = entity.data;
  switch (post.source) {
    case "inaturalist":
      return <SightingCard key={post.id} post={post} onClose={onClose} />;
    case "fixmystreet":
      return <ReportCard key={post.id} post={post} onClose={onClose} />;
    case "youtube":
      return <LiveCard key={post.id} post={post} onClose={onClose} />;
    case "flickr":
      return <PhotoCard key={post.id} post={post} onClose={onClose} />;
  }
}

function useFromYou(post: Post): MaybeRow {
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  return here && ["From you", `${fmt.distance(distanceM(here, post), units)} ${compassPoint(bearingDeg(here, post))}`];
}

function Rows({ rows }: { rows: MaybeRow[] }): ReactElement {
  return <Readout className="posts-rows" rows={rows.map((r, i) => r && ([r[0], typeof r[1] === "string" ? <Scramble text={r[1]} duration={380} delay={200 + i * 45} /> : r[1]] as const))} />;
}

function Photo({ photo, alt }: { photo: PostPhoto; alt: string }): ReactElement {
  return (
    <figure className="posts-photo">
      <img src={photo.url} alt={alt} loading="lazy" decoding="async" />
      <figcaption>{photo.credit}</figcaption>
    </figure>
  );
}

/** The post's author: picture, name and handle, and a link to their page on the platform. */
function AuthorBlock({ author, platform }: { author: PostAuthor | null; platform: string }): ReactElement | null {
  if (!author) return null;
  const { name, handle, profile, avatar } = author;
  return (
    <div className="posts-author">
      {avatar && <img className="posts-author__avatar" src={avatar} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />}
      <div className="posts-author__who">
        <span className="posts-author__label">Posted by</span>
        <span className="posts-author__name">{name ?? `@${handle}`}</span>
        {name && handle && <span className="posts-author__handle">@{handle}</span>}
      </div>
      {profile && (
        <a className="posts-author__link" href={profile} target="_blank" rel="noreferrer noopener">
          <ExternalLink size={12} /> Profile on {platform}
        </a>
      )}
    </div>
  );
}

const CLAMP_FROM = 220;

/** The source's own description, cut to a few lines until the viewer asks for the rest. */
function Description({ text }: { text: string | null }): ReactElement | null {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > CLAMP_FROM;
  return (
    <div className="posts-about">
      <p className={long && !open ? "posts-about__text posts-about__text--clamped" : "posts-about__text"}>{text}</p>
      {long && (
        <button type="button" className="posts-about__more" onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

function Link({ href, children }: { href: string | null; children: ReactNode }): ReactElement | null {
  if (!href) return null;
  return (
    <a className="v-btn v-btn--sm v-btn--primary" href={href} target="_blank" rel="noreferrer noopener">
      <ExternalLink size={13} /> {children}
    </a>
  );
}

function SightingCard({ post, onClose }: { post: Sighting; onClose: () => void }): ReactElement {
  const fromYou = useFromYou(post);
  const units = useSettings((s) => s.units);
  const now = Date.now();
  const group = GROUP_LOOK[post.kind];
  const radius = post.uncertaintyM;
  return (
    <ProfilerCard
      band="Nature sighting"
      tone="sodium"
      name={post.title}
      kicker={[post.subtitle, group.label].filter(Boolean).join(" · ")}
      onClose={onClose}
      rows={[]}
      actions={<Link href={post.link}>View on iNaturalist</Link>}
      source="iNaturalist"
    >
      {post.photo && <Photo photo={post.photo} alt={post.title} />}
      <AuthorBlock author={post.author} platform="iNaturalist" />
      <Description text={post.detail.description} />
      <Rows
        rows={[
          ["Life group", group.label],
          post.seenAt && ["Seen", describeWhen(post.seenAt, now)],
          ["Posted", describeWhen(post.postedAt, now)],
          ["Quality", QUALITY[post.detail.quality]],
          post.detail.identifications ? ["Identifications", `${fmt.int(post.detail.identifications)}${post.detail.agreements ? ` · ${fmt.int(post.detail.agreements)} agree` : ""}`] : null,
          post.detail.faves ? ["Faves", fmt.int(post.detail.faves)] : null,
          post.detail.comments ? ["Comments", fmt.int(post.detail.comments)] : null,
          post.detail.placeGuess && ["Place", post.detail.placeGuess],
          post.detail.approximate
            ? ["Position", `Approximate position, somewhere within ${radius ? fmt.distance(radius, units) : "a few kilometres"}`]
            : ["Position", `${fmt.coord(post.lat, post.lon)}${radius ? ` · ±${fmt.distance(radius, units)}` : ""}`],
          !post.detail.approximate && fromYou,
        ]}
      />
      {post.detail.approximate && <Tag>Approximate</Tag>}
    </ProfilerCard>
  );
}

function ReportCard({ post, onClose }: { post: StreetReport; onClose: () => void }): ReactElement {
  const fromYou = useFromYou(post);
  const status = STATUS_LOOK[post.detail.status];
  const { street, houseNumber, postcode, comment, updatedOn, closedOn } = post.detail;
  const address = [[street, houseNumber].filter(Boolean).join(" "), postcode].filter(Boolean).join(", ");
  const now = Date.now();
  return (
    <ProfilerCard
      band="Street report"
      tone="sodium"
      name={post.title}
      kicker={post.detail.category ?? "Fix My Street Brussels"}
      onClose={onClose}
      rows={[]}
      actions={<Link href={post.link}>View on Fix My Street</Link>}
      source="Fix My Street Brussels · Brussels Mobility · CC0"
    >
      <Description text={comment} />
      <Rows
        rows={[
          ["Status", status.label],
          ["Reported", describeWhen(post.postedAt, now, "Europe/Brussels")],
          updatedOn && updatedOn !== post.postedAt && ["Updated", describeWhen(updatedOn, now, "Europe/Brussels")],
          closedOn && ["Closed", describeWhen(closedOn, now, "Europe/Brussels")],
          address && ["Address", address],
          fromYou,
        ]}
      />
      <p className="posts-note">The source gives the day of each report, not the time.</p>
    </ProfilerCard>
  );
}

function LiveCard({ post, onClose }: { post: LiveStream; onClose: () => void }): ReactElement {
  const fromYou = useFromYou(post);
  const viewers = post.detail.viewers;
  return (
    <ProfilerCard
      band="Live video"
      tone="sodium"
      name={post.title}
      kicker={viewers === null ? "Live on YouTube" : `Live on YouTube · ${fmt.int(viewers)} watching`}
      onClose={onClose}
      rows={[]}
      actions={<Link href={post.link}>Watch on YouTube</Link>}
      source="YouTube · played in YouTube's own player"
    >
      <StreamPlayer key={post.detail.videoId} videoId={post.detail.videoId} title={post.title} />
      <AuthorBlock author={post.author} platform="YouTube" />
      <Description text={post.detail.description} />
      <Rows
        rows={[
          ["Live since", describeWhen(post.postedAt, Date.now())],
          post.detail.scheduledStart && ["Scheduled for", describeWhen(post.detail.scheduledStart, Date.now())],
          post.detail.placeName && ["Place", post.detail.placeName],
          post.detail.tags.length > 0 && ["Tags", post.detail.tags.join(", ")],
          ["Position", `${fmt.coord(post.lat, post.lon)} · as the stream states it`],
          fromYou,
        ]}
      />
    </ProfilerCard>
  );
}

/**
 * YouTube's player loads only when asked: it is heavy and it contacts YouTube.
 */
function StreamPlayer({ videoId, title }: { videoId: string; title: string }): ReactElement {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="posts-player">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      ) : (
        <Button icon={<Play size={15} />} onClick={() => setPlaying(true)}>
          Play stream
        </Button>
      )}
    </div>
  );
}

function PhotoCard({ post, onClose }: { post: PhotoPost; onClose: () => void }): ReactElement {
  const fromYou = useFromYou(post);
  const units = useSettings((s) => s.units);
  const now = Date.now();
  const { licence, description, tags, views } = post.detail;
  return (
    <ProfilerCard
      band="Photo"
      tone="sodium"
      name={post.title}
      kicker="Flickr"
      onClose={onClose}
      rows={[]}
      actions={<Link href={post.link}>View on Flickr</Link>}
      source="This product uses the Flickr API but is not endorsed or certified by SmugMug, Inc."
    >
      {post.photo && <Photo photo={post.photo} alt={post.title} />}
      <AuthorBlock author={post.author} platform="Flickr" />
      <Description text={description} />
      <Rows
        rows={[
          post.seenAt && ["Taken", describeWhen(post.seenAt, now)],
          ["Uploaded", describeWhen(post.postedAt, now)],
          ["Licence", licence],
          views !== null && ["Views", fmt.int(views)],
          tags.length > 0 && ["Tags", tags.join(", ")],
          ["Position", `${fmt.coord(post.lat, post.lon)}${post.uncertaintyM ? ` · ±${fmt.distance(post.uncertaintyM, units)}` : ""}`],
          fromYou,
        ]}
      />
    </ProfilerCard>
  );
}
