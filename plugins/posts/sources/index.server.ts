import type { PostSourceId } from "../types";
import { fixmystreet } from "./fixmystreet.server";
import { flickr } from "./flickr.server";
import { inaturalist } from "./inaturalist.server";
import type { PostSource } from "./source.server";
import { youtube } from "./youtube.server";

/** Every source of posts. A new source is one module in this folder plus one entry here and in `PostSourceId`. */
export const SOURCES: { [S in PostSourceId]: PostSource<S> } = { inaturalist, fixmystreet, youtube, flickr };

export const SOURCE_IDS = ["inaturalist", "fixmystreet", "youtube", "flickr"] as const satisfies readonly PostSourceId[];
