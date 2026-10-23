/**
 * Payloads of the Posts plugin: public, geotagged posts that people made at a place, normalised to one shape.
 * A post carries what its source publishes about it: the author's name, handle, avatar and profile link, the photo with
 * its credit and licence, and the source's own description and counts. Nothing here fetches a person's other posts.
 */

export type PostSourceId = "inaturalist" | "fixmystreet" | "youtube" | "flickr";

/** A rectangle in degrees. */
export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface PostPhoto {
  /** A large image for the profile card. */
  url: string;
  /** A small square image for the map. */
  thumb: string;
  /** Credit as the source words it, e.g. "(c) Name, some rights reserved (CC BY-NC)" or "Photo: Name on Flickr · CC BY 2.0". */
  credit: string;
  /** Short licence name, e.g. "CC BY-NC 4.0" or "All rights reserved". */
  licence: string;
}

/** The person or channel behind a post, as far as the source publishes it. Every address passed `webUrl`. */
export interface PostAuthor {
  name: string | null;
  /** The account name, without "@". */
  handle: string | null;
  /** The author's own page on the platform. */
  profile: string | null;
  avatar: string | null;
}

interface PostBase<S extends PostSourceId, K extends string, D> {
  /** Unique across sources: "<source>:<upstream id>". */
  id: string;
  source: S;
  /** What kind of post this is within its source: a life group, a report category, "live", "photo". */
  kind: K;
  lat: number;
  lon: number;
  /** Radius in metres that holds the true position; null when the source does not say. */
  uncertaintyM: number | null;
  /**
   * When it was posted. An ISO date-time with an offset, or a date (YYYY-MM-DD) when the source has no time.
   */
  postedAt: string;
  /**
   * When the subject was seen or recorded: an ISO date-time with an offset, a wall-clock date-time without an offset
   * (the camera's local time), a date, or null when unknown.
   */
  seenAt: string | null;
  title: string;
  subtitle: string | null;
  photo: PostPhoto | null;
  /** Null when the source names nobody. */
  author: PostAuthor | null;
  /** The post's own page at the source. */
  link: string | null;
  detail: D;
}

// ── iNaturalist ───────────────────────────────────────────────────

/** Life groups, coarse enough to tell apart on a map with the fixed VANTAGE palette. */
export type LifeGroup = "plants" | "fungi" | "birds" | "vertebrates" | "invertebrates" | "other";

export type QualityGrade = "research" | "needs_id" | "casual";

export interface SightingDetail {
  scientificName: string | null;
  /** Taxon rank, e.g. "species", "genus". */
  rank: string | null;
  quality: QualityGrade;
  /** The contributor or the species' protection rules hide the exact spot; the position is random within `uncertaintyM`. */
  approximate: boolean;
  /** The observer's free-text note. */
  description: string | null;
  /** Where the observer says it was, e.g. "Piazza del Colosseo, Rome, Lazio, IT". */
  placeGuess: string | null;
  identifications: number | null;
  /** Identifications that agree with the observer's. */
  agreements: number | null;
  faves: number | null;
  comments: number | null;
}

export type Sighting = PostBase<"inaturalist", LifeGroup, SightingDetail>;

// ── Fix My Street Brussels ────────────────────────────────────────

export type ReportCategory = "roads" | "cleanliness" | "nature" | "signs" | "lighting" | "furniture" | "monuments" | "vehicles" | "other";
export type ReportStatus = "new" | "progress" | "closed";

export interface ReportDetail {
  /** The full category path in the source's language (French or Dutch), e.g. "Propreté publique / Corbeille débordante". */
  category: string | null;
  status: ReportStatus;
  /** Street name without a house number. */
  street: string | null;
  postcode: string | null;
  houseNumber: string | null;
  /** The reporter's free-text description, in the language they wrote it. */
  comment: string | null;
  /** Dates (YYYY-MM-DD) the layer records after the report was made. */
  updatedOn: string | null;
  closedOn: string | null;
}

export type StreetReport = PostBase<"fixmystreet", ReportCategory, ReportDetail>;

// ── YouTube ───────────────────────────────────────────────────────

export interface LiveDetail {
  videoId: string;
  /** People watching now; null when the stream hides the count. */
  viewers: number | null;
  description: string | null;
  tags: string[];
  /** When the broadcaster planned to start (ISO date-time); null when not scheduled. */
  scheduledStart: string | null;
  /** The place the broadcaster names for the recording, e.g. "Piazza Navona". */
  placeName: string | null;
}

export type LiveStream = PostBase<"youtube", "live", LiveDetail>;

// ── Flickr ────────────────────────────────────────────────────────

export interface PhotoDetail {
  /** The photo's licence, e.g. "CC BY 4.0" or "All rights reserved". */
  licence: string;
  description: string | null;
  tags: string[];
  views: number | null;
}

export type PhotoPost = PostBase<"flickr", "photo", PhotoDetail>;

// ── Replies ───────────────────────────────────────────────────────

export type Post = Sighting | StreetReport | LiveStream | PhotoPost;
export type PostOf<S extends PostSourceId> = Extract<Post, { source: S }>;

export interface PostsReply<S extends PostSourceId = PostSourceId> {
  source: S;
  /** The area the server searched: the requested view rounded outward to its cache grid. */
  box: Box;
  /** Newest first. */
  posts: PostOf<S>[];
  /** True when the area held more posts than one request returns; the newest are shown. */
  capped: boolean;
}

export interface SourceStatus {
  id: PostSourceId;
  label: string;
  /** False for an optional source whose free key is not set; it then fetches nothing. */
  configured: boolean;
}

/** A count of posts near a point. `capped`: the source returned its most posts per request, so there may be more. */
export type Tally = { ok: true; count: number; capped: boolean } | { ok: false; error: string };

/** What the Briefing tile shows: recent posts within `radiusKm` of a point. */
export interface NearSummary {
  radiusKm: number;
  /** iNaturalist posts of the last 24 h. */
  sightings: Tally;
  /** The newest of those sightings that has a photo. */
  newest: Sighting | null;
  /** Street reports of the last 7 days; null outside the Brussels region. */
  reports: Tally | null;
  /** Live streams now; null when YouTube has no key. */
  videos: Tally | null;
  /** Photos of the last 24 h; null when Flickr has no key. */
  photos: Tally | null;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    post: Post;
  }
}
