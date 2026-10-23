import { Compass, Crosshair, MapPin, Shuffle } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { errorMessage } from "../../app/core/api";
import { fmt } from "../../app/core/format";
import { useNow, usePoll } from "../../app/core/hooks";
import { useLocation } from "../../app/core/location";
import { useSettings } from "../../app/core/settings";
import { Button, Empty, LiveDot, Scanning } from "../../app/ui";
import { distanceM, type LatLon } from "../../shared/geo";
import { fetchNear, fetchRandomCity } from "./client";
import { Focus } from "./Focus";
import { cameraItem, fromPoint } from "./items";
import { PlaceSearch } from "./PlaceSearch";
import { useMapCentre } from "./store";
import { Tile } from "./Tile";
import type { CamerasNear } from "./types";

/** Where the wall looks. Null means "where you are". */
export interface Origin extends LatLon {
  label: string;
}

/** How many tiles play live video at once; the rest show pictures that refresh. */
const LIVE_TILES = 4;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The Near tab: a wall of the cameras nearest a point, each refreshing on its operator's schedule.
 * When nothing is within range, the wall moves to the nearest city that has open cameras.
 */
export function NearTab({ origin, onOrigin, randomNonce }: { origin: Origin | null; onOrigin: (o: Origin | null) => void; randomNonce: number }): ReactElement {
  const here = useLocation((s) => s.here);
  const status = useLocation((s) => s.status);
  const locationNote = useLocation((s) => s.note);
  const units = useSettings((s) => s.units);
  const mapCentre = useMapCentre((s) => s.centre);
  const now = useNow(30_000);
  const [focus, setFocus] = useState<number | null>(null);
  const [shuffling, setShuffling] = useState(false);
  const [shuffleError, setShuffleError] = useState<string | null>(null);
  // Starts at the current value so that returning to this tab does not replay a jump made earlier.
  const handledRandom = useRef(randomNonce);

  const point: LatLon | null = origin ?? (here ? { lat: here.lat, lon: here.lon } : null);
  const key = point ? `${point.lat.toFixed(3)},${point.lon.toFixed(3)}` : "none";
  const near = usePoll(
    async (signal): Promise<CamerasNear & { key: string }> => {
      if (!point) throw new Error("The wall has no point to look around.");
      return { ...(await fetchNear(point, signal)), key };
    },
    null,
    [key],
    point === null,
  );
  const wall = near.data?.key === key ? near.data : null;
  const cameras = wall?.cameras ?? [];

  useEffect(() => {
    setFocus(null);
  }, [key]);

  useEffect(() => {
    if (!wall || cameras.length === 0 || randomNonce === handledRandom.current) return;
    handledRandom.current = randomNonce;
    setFocus(Math.floor(Math.random() * cameras.length));
  }, [wall, cameras.length, randomNonce]);

  const items = useMemo(() => (wall ? cameras.map((c) => cameraItem(c, wall.center, units, now)) : []), [wall, cameras, units, now]);

  const somewhereElse = async (): Promise<void> => {
    setShuffling(true);
    setShuffleError(null);
    try {
      const city = await fetchRandomCity();
      onOrigin({ lat: city.lat, lon: city.lon, label: city.name });
    } catch (err) {
      setShuffleError(errorMessage(err));
    } finally {
      setShuffling(false);
    }
  };

  const placeName = wall?.place ?? origin?.label ?? here?.label ?? "Your surroundings";
  const farthest = wall ? cameras.reduce((m, c) => Math.max(m, distanceM(wall.center, c)), 0) : 0;
  const liveCount = cameras.filter((c) => c.stream).length;
  const licenses = [...new Set(cameras.map((c) => c.license))];

  return (
    <div className="webcams-near">
      <div className="webcams-hero">
        <div className="webcams-hero__titles">
          <div className="v-eyebrow v-eyebrow--sodium webcams-eyebrow">
            <LiveDot tone="sodium" /> Live wall
          </div>
          <h2 className="webcams-hero__place">{placeName}</h2>
          <p className="webcams-hero__sub num">
            {wall ? (cameras.length ? `${cameras.length} cameras within ${fmt.distance(Math.max(farthest, 100), units)}${liveCount ? ` · ${liveCount} with live video` : ""}` : "No camera answered") : point ? "Looking for cameras" : status === "locating" ? "Finding where you are" : "Location unknown"}
          </p>
        </div>
        <div className="webcams-hero__tools">
          <PlaceSearch onPick={(p) => onOrigin({ lat: p.lat, lon: p.lon, label: p.name })} />
          <div className="webcams-hero__buttons">
            <Button size="sm" icon={<Crosshair size={13} />} disabled={origin === null} onClick={() => onOrigin(null)}>
              Near me
            </Button>
            <Button
              size="sm"
              icon={<MapPin size={13} />}
              disabled={mapCentre === null}
              title={mapCentre ? "Look through cameras around the centre of the City map" : "Turn on a camera layer on the City map, then come back"}
              onClick={() => mapCentre && onOrigin({ ...mapCentre, label: "The map centre" })}
            >
              Map centre
            </Button>
            <Button size="sm" icon={<Shuffle size={13} />} disabled={shuffling} onClick={() => void somewhereElse()}>
              Somewhere else
            </Button>
          </div>
        </div>
      </div>

      {shuffleError && (
        <Empty title="No place to jump to" tone="error">
          {shuffleError}
        </Empty>
      )}

      {wall?.moved && (
        <div className="webcams-moved" role="status">
          <Compass size={16} />
          <div>
            <div className="webcams-moved__title">
              The nearest cameras are in {wall.place ?? "another city"}, {fmt.distance(wall.nearestM, units)} away.
            </div>
            <div className="webcams-moved__sub">
              No operator within 50 km of {origin?.label ?? here?.label ?? "this point"} publishes cameras. Showing {wall.place ?? "that city"} instead. Search a place, or pick Somewhere else.
            </div>
          </div>
        </div>
      )}

      {!point && (
        <Empty title={status === "failed" ? "VANTAGE cannot tell where you are" : "Finding where you are"} tone={status === "failed" ? "error" : undefined}>
          {locationNote ?? "Search for a place above, or allow location in your browser to see the cameras around you."}
        </Empty>
      )}
      {point && !wall && !near.error && <Scanning label="Looking for cameras" />}
      {near.error && !wall && (
        <Empty title="The camera wall could not load" tone="error" action={<Button onClick={near.refresh}>Try again</Button>}>
          {near.error.message}
        </Empty>
      )}
      {wall && cameras.length === 0 && (
        <Empty title="No operator answered" tone="error" action={<Button onClick={near.refresh}>Try again</Button>}>
          {wall.failed.length ? `Unavailable: ${wall.failed.join(", ")}. ` : ""}Check your connection and try again.
        </Empty>
      )}

      {wall && cameras.length > 0 && (
        <>
          <div className="webcams-grid">
            {cameras.map((c, i) => {
              let seen = 0;
              for (let j = 0; j < i; j++) if (cameras[j]?.stream) seen++;
              return (
                <Tile
                  key={c.id}
                  tag={`CAM ${pad(i + 1)}`}
                  label={`${c.name}, ${c.providerName}`}
                  src={c.image}
                  refreshS={c.refreshS}
                  stream={c.stream && seen < LIVE_TILES ? c.stream : null}
                  alt={`View from ${c.name}`}
                  index={i}
                  selected={focus === i}
                  onOpen={() => setFocus(i)}
                >
                  <span className="webcams-tile__name">{c.name}</span>
                  <span className="webcams-tile__sub num">
                    {c.providerName} · {fromPoint(wall.center, c, units)}
                  </span>
                </Tile>
              );
            })}
          </div>
          <p className="webcams-credit">Pictures: {licenses.join("; ")}.</p>
        </>
      )}

      <AnimatePresence>{focus !== null && items.length > 0 && <Focus key="focus" items={items} index={Math.min(focus, items.length - 1)} onIndex={setFocus} onClose={() => setFocus(null)} />}</AnimatePresence>
    </div>
  );
}
