import { Search as SearchIcon } from "lucide-react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { useEffect, useState, type ReactElement } from "react";
import type { Place } from "../../shared/location";
import { api, qs } from "../../app/core/api";
import { profile } from "../../app/core/profile";
import { sfx } from "../../app/core/sound";
import { Input } from "../../app/ui";

/**
 * Search any place on Earth (OpenStreetMap via Photon). Results lean towards what is on screen. With `onClose` (the
 * phone's expanded field) it takes focus, offers Cancel, and closes on Escape or once a place is chosen.
 */
export function Search({ map, preset, onClose }: { map: MapLibreMap; preset: string | null; onClose?: () => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [cursor, setCursor] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (preset) setQuery(preset);
  }, [preset]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      const c = map.getCenter();
      api<Place[]>(qs("/api/core/geocode", { q: query.trim(), lat: c.lat, lon: c.lng }), { signal: controller.signal })
        .then((r) => {
          setResults(r);
          setCursor(0);
          setError(r.length ? null : `Nothing called “${query.trim()}” found.`);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException)) setError(err instanceof Error ? err.message : String(err));
        });
    }, 280);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, map]);

  const choose = (p: Place): void => {
    sfx.click();
    setResults([]);
    setQuery(p.name);
    map.flyTo({ center: [p.lon, p.lat], zoom: p.kind === "city" || p.kind === "country" || p.kind === "state" ? 12 : 17, pitch: 60, duration: 2200, essential: true }, { userNavigation: true });
    profile.open({ kind: "place", id: `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`, data: p });
    onClose?.();
  };

  return (
    <div className="city-search">
      <Input
        prompt={<SearchIcon size={14} />}
        placeholder="Search places"
        value={query}
        aria-label="Search places"
        autoFocus={onClose !== undefined}
        enterKeyHint="search"
        trailing={
          onClose && (
            <button type="button" className="city-search__cancel" onClick={onClose}>
              Cancel
            </button>
          )
        }
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setCursor((c) => Math.min(results.length - 1, c + 1));
          else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
          else if (e.key === "Enter" && results[cursor]) choose(results[cursor]);
          else if (e.key === "Escape") {
            setResults([]);
            e.currentTarget.blur();
            onClose?.();
          }
        }}
      />
      {(results.length > 0 || error) && (
        <div className="v-panel city-search__results" role="listbox">
          {error && <div className="city-search__msg">{error}</div>}
          {results.map((p, i) => (
            <button key={`${p.lat},${p.lon},${i}`} type="button" role="option" aria-selected={i === cursor} className="v-row" onMouseMove={() => setCursor(i)} onClick={() => choose(p)}>
              <span className="v-row__main">
                <span className="v-row__title" style={{ display: "block" }}>
                  {p.name}
                </span>
                <span className="v-row__sub" style={{ display: "block" }}>
                  {[p.kind.replace(/_/g, " "), p.context].filter(Boolean).join(" · ")}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
