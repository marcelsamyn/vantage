import { Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";
import type { Place } from "../../shared/location";
import { api, qs } from "../../app/core/api";
import { sfx } from "../../app/core/sound";
import { Input } from "../../app/ui";

/** Search any place on Earth (OpenStreetMap via the kernel geocoder) and hand the choice back. */
export function PlaceSearch({ onPick }: { onPick: (place: Place) => void }): ReactElement {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [cursor, setCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  // The name `choose` wrote into the box. Searching for it again would reopen the list the user just closed.
  const chosen = useRef<string | null>(null);

  useEffect(() => {
    const text = query.trim();
    if (text === chosen.current) return;
    chosen.current = null;
    if (text.length < 2) {
      setResults([]);
      setMessage(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<Place[]>(qs("/api/core/geocode", { q: text }), { signal: controller.signal })
        .then((found) => {
          setResults(found);
          setCursor(0);
          setMessage(found.length ? null : `Nothing called “${text}” found. Try a city name.`);
        })
        .catch((err: unknown) => {
          if (!(err instanceof DOMException)) setMessage(err instanceof Error ? err.message : String(err));
        });
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (place: Place): void => {
    sfx.click();
    setResults([]);
    setMessage(null);
    chosen.current = place.name.trim();
    setQuery(place.name);
    onPick(place);
  };

  return (
    <div className="webcams-search">
      <Input
        prompt={<Search size={14} />}
        placeholder="Look through cameras in another place"
        aria-label="Search for a place"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setCursor((c) => Math.min(results.length - 1, c + 1));
          else if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
          else if (e.key === "Enter" && results[cursor]) choose(results[cursor]);
          else if (e.key === "Escape") {
            setResults([]);
            setMessage(null);
          }
        }}
      />
      {(results.length > 0 || message) && (
        <div className="v-panel v-panel--solid webcams-search__results" role="listbox">
          {message && <div className="webcams-search__message">{message}</div>}
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
