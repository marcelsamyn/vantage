import { ExternalLink, Pause, Play, Volume2 } from "lucide-react";
import type { CSSProperties, ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { Button, LiveDot, Scanning, Scramble, Tag } from "../../app/ui";
import { distanceM } from "../../shared/geo";
import { playMic, setVolume, stopMic, usePlayer } from "./audio";
import { Spectrogram } from "./Spectrogram";
import { DAYLIGHT_WORDS, DaylightIcon } from "./Daylight";
import { clockAt, daylightAt } from "./sun";
import type { Microphones } from "./types";

const ROUTE_NOTES = {
  direct: null,
  relay: "This stream does not allow direct analysis, so VANTAGE relays it.",
  hls: "Live HLS audio from a hydrophone, a few segments behind real time.",
} as const;

/** What is playing: name, place, the time and light there, controls, and the spectrogram. */
export function Player({ sources }: { sources: Microphones["sources"] }): ReactElement {
  const { mic, phase, route, error, volume } = usePlayer();
  const here = useLocation((s) => s.here);
  const units = useSettings((s) => s.units);
  const now = useNow(15_000);

  const on = phase === "playing" || phase === "connecting";
  const state = phase === "error" ? "Stopped" : phase === "connecting" ? "Connecting" : phase === "playing" ? "Live" : mic ? "Stopped" : "Idle";
  const clock = mic ? clockAt(mic.timezone, mic.lon, new Date(now)) : null;
  const daylight = mic ? daylightAt(mic.lat, mic.lon, new Date(now)) : null;
  const away = mic && here ? distanceM(here, mic) : null;
  const credit = mic && sources.find((s) => s.id === mic.source);

  return (
    <div className="listen-player">
      <div className="listen-player__id">
        <div className="listen-player__status v-eyebrow">
          <LiveDot tone={phase === "playing" ? "sodium" : "mint"} live={phase === "playing"} />
          <span className={phase === "playing" ? "sodium" : undefined}>{state}</span>
          {mic && <span className="faint">· {mic.format === "hls" ? "Underwater" : "On land"}</span>}
        </div>

        <h2 className="listen-player__name display">{mic ? <Scramble text={mic.format === "hls" ? mic.place : mic.name} duration={520} /> : "Pick a microphone"}</h2>

        <p className="listen-player__where">
          {mic ? [mic.format === "hls" ? "Hydrophone" : mic.place, mic.country].filter(Boolean).join(" · ") : "Choose a microphone from the list to listen."}
        </p>

        {mic && clock && daylight && (
          <div className="listen-player__facts">
            <span className="listen-fact">
              <DaylightIcon daylight={daylight} />
              <span className="num">{clock.text}</span>
              <span className="dim">{clock.kind === "local" ? "there" : "sun time"}</span>
            </span>
            <Tag tone={daylight === "night" ? undefined : "sodium"}>{DAYLIGHT_WORDS[daylight]}</Tag>
            {away !== null && <span className="dim num">{fmt.distance(away, units)} from you</span>}
          </div>
        )}

        <div className="listen-player__status-line" aria-live="polite">
          {error ? (
            <span className="alarm">{error}</span>
          ) : phase === "connecting" ? (
            <Scanning label="Connecting" />
          ) : phase === "playing" && route ? (
            <span className="dim">{ROUTE_NOTES[route]}</span>
          ) : null}
        </div>

        <div className="listen-player__controls">
          {mic && phase === "error" ? (
            <Button variant="primary" onClick={() => playMic(mic)}>
              Try again
            </Button>
          ) : (
            <Button variant="primary" disabled={!mic} icon={on ? <Pause size={14} /> : <Play size={14} />} onClick={() => mic && (on ? stopMic() : playMic(mic))}>
              {on ? "Stop" : "Play"}
            </Button>
          )}
          <label className="listen-volume">
            <Volume2 size={14} aria-hidden />
            <input
              type="range"
              className="listen-range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              aria-label="Volume"
              style={{ "--fill": `${volume * 100}%` } as CSSProperties}
              onChange={(e) => setVolume(e.currentTarget.valueAsNumber)}
            />
          </label>
          {mic && credit && (
            <a className="listen-credit" href={mic.homepage} target="_blank" rel="noreferrer noopener" title={`${credit.name}: ${credit.licence}`}>
              {credit.name}
              <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </div>
      </div>
      <Spectrogram />
    </div>
  );
}
