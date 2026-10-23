import { useMemo } from "react";
import { fmt } from "../../app/core/format";
import { useProfile } from "../../app/core/profile";
import { useDomMarkers, type DomMarker, type MapLayerProps } from "../city/extension";
import { usePostsInView } from "./client";
import { openPost } from "./marks";
import type { LiveStream } from "./types";
import "./posts.css";

interface Beacon {
  stream: LiveStream;
  selected: boolean;
}

const watching = (s: LiveStream): string => (s.detail.viewers === null ? "Live now" : `${fmt.int(s.detail.viewers)} watching`);

function buildBeacon(): DomMarker<Beacon> {
  const element = document.createElement("div");
  element.className = "posts-live";
  const body = document.createElement("button");
  body.type = "button";
  body.className = "posts-live__body";
  body.innerHTML = '<span class="posts-live__pulse"></span><span class="posts-live__dot"></span>';
  const label = document.createElement("span");
  label.className = "posts-live__label";
  body.append(label);
  element.append(body);
  return {
    element,
    update: ({ stream, selected }) => {
      label.textContent = watching(stream);
      body.setAttribute("aria-label", `${stream.title}, ${watching(stream)}. Open the stream`);
      body.classList.toggle("posts-live__body--selected", selected);
    },
  };
}

/**
 * YouTube streams that are live now and say where they are filmed. Each one pulses softly in sodium; hover or focus
 * shows how many people are watching. The pulse is CSS on a few DOM markers, so no frame loop runs for it.
 */
export default function LiveLayer({ map, report }: MapLayerProps): null {
  const { posts } = usePostsInView(map, "youtube", 5 * 60_000, report);
  const selected = useProfile((s) => (s.entity?.kind === "post" ? s.entity.id : null));
  const beacons = useMemo(() => (posts ?? []).map((stream): Beacon => ({ stream, selected: stream.id === selected })), [posts, selected]);
  useDomMarkers(map, beacons, { id: (b) => b.stream.id, at: (b) => b.stream, build: buildBeacon, onClick: (b) => openPost(b.stream) });
  return null;
}
