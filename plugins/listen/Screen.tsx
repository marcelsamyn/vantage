import { useEffect, useState, type ReactElement } from "react";
import { feed } from "../../app/core/feed";
import { useLocation } from "../../app/core/location";
import { useIntent } from "../../app/core/nav";
import { Button, Empty, Page, Panel, Scanning } from "../../app/ui";
import { Birds } from "./Birds";
import { nearestMic, useMicrophones } from "./client";
import { ListeningMap } from "./ListeningMap";
import { MicList } from "./MicList";
import { Meteors } from "./Meteors";
import { Player } from "./Player";
import { playMic, usePlayer } from "./audio";
import "./listen.css";

export default function ListenScreen(): ReactElement {
  const { data, error, refresh } = useMicrophones();
  const here = useLocation((s) => s.here);
  const selected = usePlayer((s) => s.mic?.id ?? null);
  const playing = usePlayer((s) => s.phase === "playing");

  // "Listen to the nearest microphone" can arrive before the list or your position has loaded; hold it until both have.
  const [wantNearest, setWantNearest] = useState(false);
  useIntent("listen", ({ action }) => {
    if (action === "nearest") setWantNearest(true);
  });
  useEffect(() => {
    if (!wantNearest || !data) return;
    if (!here) {
      setWantNearest(false);
      feed({ level: "info", source: "listen", title: "Listening nearby needs your location", detail: "Allow location access, or pick a microphone on the map." }, { toast: true });
      return;
    }
    setWantNearest(false);
    const mic = nearestMic(data.microphones, here);
    if (mic) playMic(mic);
  }, [wantNearest, data, here]);

  return (
    <Page eyebrow="Listen" title="Listen" lede="Live microphones around the world, birds singing around you right now, and the meteors that crossed the sky last night.">
      <div className="listen-stack">
        <Panel flush solid active={playing} className="listen-hero">
          {error && !data ? (
            <div className="listen-hero__error">
              <Empty title="Microphones unavailable" tone="error" action={<Button onClick={refresh}>Try again</Button>}>
                {error.message}
              </Empty>
            </div>
          ) : !data ? (
            <div className="listen-hero__error">
              <Scanning label="Finding microphones" />
            </div>
          ) : (
            <>
              <div className="listen-hero__stage">
                <ListeningMap mics={data.microphones} here={here} selectedId={selected} onChoose={playMic} />
                <aside className="listen-hero__list" aria-label="All microphones">
                  <div className="v-eyebrow listen-hero__list-head">{here ? "Nearest first" : "All microphones"}</div>
                  <MicList mics={data.microphones} here={here} onChoose={playMic} />
                </aside>
              </div>
              <Player sources={data.sources} />
            </>
          )}
        </Panel>
        <div className="listen-columns">
          <Birds />
          <Meteors />
        </div>
      </div>
    </Page>
  );
}
