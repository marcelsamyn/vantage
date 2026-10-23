import { useEffect } from "react";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { activityWords, fetchAuroraAt, fetchNow, fetchShields, isDark, stormEffects, useSpaceWx } from "./client";

/** A geomagnetic storm of at least this G-scale level raises an alert. */
const STORM_SCALE = 1;
/** Aurora chance at your location, in percent, that is worth stepping outside for. */
const AURORA_CHANCE = 30;

/** Keeps `useSpaceWx` fresh and raises feed events for storms, for aurora chances where you are and for Forbush decreases. */
export default function SpaceWxWatcher(): null {
  const here = useLocation((s) => s.here);
  const now = usePoll((signal) => fetchNow(signal), 5 * 60_000, []);
  const key = here ? `${here.lat.toFixed(1)},${here.lon.toFixed(1)}` : null;
  const aurora = usePoll((signal) => (here ? fetchAuroraAt(here, signal) : Promise.reject(new Error("no location"))), 10 * 60_000, [key], !here);
  const shields = usePoll((signal) => (here ? fetchShields(here, signal) : Promise.reject(new Error("no location"))), 15 * 60_000, [key], !here);

  useEffect(() => {
    if (now.data) useSpaceWx.setState({ now: now.data, error: null });
    else if (now.error) useSpaceWx.setState({ error: now.error.message });
  }, [now.data, now.error]);

  useEffect(() => {
    useSpaceWx.setState({ aurora: aurora.data ?? null });
  }, [aurora.data]);

  useEffect(() => {
    useSpaceWx.setState({ shields: shields.data ?? null });
  }, [shields.data]);

  useEffect(() => {
    const cosmic = shields.data?.cosmic;
    const fall = cosmic?.ok ? cosmic.data.forbush : null;
    if (!fall?.ongoing) return;
    feed(
      {
        level: "live",
        source: "spacewx",
        title: `Cosmic rays down ${fall.depthPct.toFixed(0)} %: a Forbush decrease`,
        detail: `Neutron monitors fell from ${fmt.clock(fall.onsetAt)}. A solar storm cloud is sweeping cosmic rays away from Earth, and the dip lasts a few days.`,
        go: { screen: "sky", action: "open" },
      },
      { key: `spacewx.forbush.${fall.onsetAt}`, dedupeMs: 24 * 3_600_000 },
    );
  }, [shields.data]);

  useEffect(() => {
    const kp = now.data?.kp;
    if (!kp?.ok || kp.data.scale < STORM_SCALE) return;
    const { scale, now: value } = kp.data;
    feed(
      { level: "alert", source: "spacewx", title: `Geomagnetic storm G${scale}: ${activityWords(scale, value).toLowerCase()}`, detail: `Kp ${value.toFixed(1)} now. ${stormEffects(scale)}` },
      { key: `spacewx.storm.G${scale}`, dedupeMs: 6 * 3_600_000, toast: true },
    );
  }, [now.data]);

  useEffect(() => {
    if (!here || !aurora.data || aurora.data.chancePct < AURORA_CHANCE || !isDark(here)) return;
    const pole = here.lat >= 0 ? "north" : "south";
    feed(
      { level: "live", source: "spacewx", title: "Aurora possible at your location", detail: `${aurora.data.chancePct} % chance right now and it is dark. Find a dark spot and look ${pole}.` },
      { key: "spacewx.aurora", dedupeMs: 6 * 3_600_000, toast: true },
    );
  }, [aurora.data, here]);

  return null;
}
