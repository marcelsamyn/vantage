import { ExternalLink, MapPin, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";
import { api, errorMessage, qs } from "../../app/core/api";
import { feed } from "../../app/core/feed";
import { fmt } from "../../app/core/format";
import { useLocation } from "../../app/core/location";
import { sfx } from "../../app/core/sound";
import { Button, Eyebrow, Input, Scanning, Tag } from "../../app/ui";
import type { Place } from "../../shared/location";
import { sendNote } from "./client";
import { useReach } from "./store";
import { CAMERA_NOTE, NOTE_MAX, type CreatedNote } from "./types";

const PLACEHOLDER = "<direction>";
const asNumber = (s: string): number => (s.trim() === "" ? NaN : Number(s));

/**
 * Write a note for the OpenStreetMap world map, check exactly what will be sent, then send it.
 * Nothing leaves the computer until the second step's "Post publicly" button is pressed.
 */
export function NoteDialog(): ReactElement {
  const draft = useReach((s) => s.draft);
  const setDraft = useReach((s) => s.setDraft);
  const here = useLocation((s) => s.here);
  const [text, setText] = useState("");
  const [latText, setLatText] = useState("");
  const [lonText, setLonText] = useState("");
  const [step, setStep] = useState<"write" | "confirm">("write");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<CreatedNote | null>(null);
  const [lookup, setLookup] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [searching, setSearching] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const open = draft !== null;

  // The store's draft only seeds the form when the dialog opens; edits stay in the form.
  useEffect(() => {
    if (!draft) return;
    setText(draft.text);
    setLatText(draft.lat === null ? "" : String(draft.lat));
    setLonText(draft.lon === null ? "" : String(draft.lon));
    setStep("write");
    setError(null);
    setDone(null);
    setPlaces(null);
    setLookup("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open && step === "write" && !done) area.current?.focus();
  }, [open, step, done]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape" && !sending) setDraft(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sending, setDraft]);

  const close = (): void => {
    if (!sending) setDraft(null);
  };

  const find = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (lookup.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      setPlaces((await api<Place[]>(qs("/api/core/geocode", { q: lookup.trim() }))).slice(0, 4));
    } catch (err) {
      setError(`Place search failed: ${errorMessage(err)}`);
    } finally {
      setSearching(false);
    }
  };

  const lat = asNumber(latText);
  const lon = asNumber(lonText);
  const position = Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const problem = !position
    ? "Enter a latitude between -90 and 90 and a longitude between -180 and 180."
    : text.trim().length === 0
      ? "Write what mappers should know."
      : text.includes(PLACEHOLDER)
        ? `Replace ${PLACEHOLDER} with the direction the camera faces, or delete that sentence.`
        : text.length > NOTE_MAX
          ? `Notes can be up to ${NOTE_MAX} characters.`
          : null;

  const post = async (): Promise<void> => {
    if (problem) return;
    setSending(true);
    setError(null);
    try {
      const created = await sendNote({ lat, lon, text });
      sfx.notify();
      feed({ level: "good", source: "reach", title: "Map note posted", detail: `Note ${created.id} is public on OpenStreetMap.` }, { key: `reach-note:${created.id}` });
      setDone(created);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="reach-dialog__scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            className="reach-dialog v-panel v-panel--solid"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reach-dialog-title"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            <div className="reach-dialog__body">
              <Eyebrow tone="ice">{done ? "Posted" : step === "write" ? "Leave a map note" : "Check before sending"}</Eyebrow>
              <h2 id="reach-dialog-title" className="reach-dialog__title">
                {done ? "Your note is on the map" : step === "write" ? "A note for the world map" : "Send this note publicly?"}
              </h2>

              {done ? (
                <>
                  <p className="reach-dialog__copy">Mappers can see it now. It cannot be deleted from here, and it stays visible after it is closed.</p>
                  <div className="reach-dialog__actions">
                    <a className="v-btn v-btn--primary" href={done.url} target="_blank" rel="noreferrer noopener">
                      <ExternalLink size={14} /> See note {done.id}
                    </a>
                    <Button onClick={close}>Done</Button>
                  </div>
                </>
              ) : step === "write" ? (
                <>
                  <p className="reach-dialog__copy">Cameras you report here can show up on the Surveillance cameras layer once a mapper adds them.</p>
                  <label className="reach-dialog__label" htmlFor="reach-note-text">
                    <span className="v-eyebrow">Note</span>
                    <span className="v-eyebrow num">
                      {text.length}/{NOTE_MAX}
                    </span>
                  </label>
                  <textarea id="reach-note-text" ref={area} className="v-textarea reach-dialog__text" rows={5} value={text} maxLength={NOTE_MAX} placeholder="What is here, and what should mappers check?" onChange={(e) => setText(e.target.value)} />
                  <div className="reach-dialog__row">
                    <Button size="sm" onClick={() => setText(CAMERA_NOTE)}>
                      Use the camera template
                    </Button>
                    <span className="reach-dialog__hint">Then replace {PLACEHOLDER} with north, south-east and so on.</span>
                  </div>

                  <div className="reach-dialog__label">
                    <span className="v-eyebrow">Position</span>
                    {here && (
                      <button
                        type="button"
                        className="reach-dialog__link"
                        onClick={() => {
                          setLatText(here.lat.toFixed(5));
                          setLonText(here.lon.toFixed(5));
                        }}
                      >
                        <MapPin size={12} /> Use my location{here.source === "ip" ? " (city-level)" : ""}
                      </button>
                    )}
                  </div>
                  <div className="reach-dialog__coords">
                    <Input prompt="lat" inputMode="decimal" aria-label="Latitude" value={latText} onChange={(e) => setLatText(e.target.value)} />
                    <Input prompt="lon" inputMode="decimal" aria-label="Longitude" value={lonText} onChange={(e) => setLonText(e.target.value)} />
                  </div>
                  <form className="reach-dialog__find" onSubmit={(e) => void find(e)}>
                    <Input prompt={<Search size={13} />} placeholder="Or find a place, then press Enter" aria-label="Find a place" value={lookup} onChange={(e) => setLookup(e.target.value)} />
                  </form>
                  {searching && <Scanning label="Searching" />}
                  {places && (
                    <ul className="reach-dialog__places">
                      {places.length === 0 && <li className="reach-dialog__hint">No place matches that. Try the street and city.</li>}
                      {places.map((p) => (
                        <li key={`${p.lat},${p.lon}`}>
                          <button
                            type="button"
                            className="reach-dialog__place"
                            onClick={() => {
                              setLatText(p.lat.toFixed(5));
                              setLonText(p.lon.toFixed(5));
                              setPlaces(null);
                            }}
                          >
                            <span>{p.name}</span>
                            <span className="reach-dialog__hint">{p.context}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  {(problem || error) && (
                    <p className="reach-dialog__error" role="alert">
                      {error ?? problem}
                    </p>
                  )}
                  <div className="reach-dialog__actions">
                    <Button
                      variant="primary"
                      disabled={problem !== null}
                      onClick={() => {
                        setError(null);
                        setStep("confirm");
                      }}
                    >
                      Review before sending
                    </Button>
                    <Button variant="ghost" onClick={close}>
                      Cancel
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="reach-dialog__label">
                    <span className="v-eyebrow">Exact text</span>
                    <Tag tone="alarm">Public</Tag>
                  </div>
                  <pre className="reach-dialog__exact">{text}</pre>
                  <div className="reach-dialog__label">
                    <span className="v-eyebrow">Position</span>
                  </div>
                  <p className="reach-dialog__pos num">{fmt.coord(lat, lon)}</p>
                  <div className="reach-dialog__label">
                    <span className="v-eyebrow">Goes to</span>
                  </div>
                  <p className="reach-dialog__pos">openstreetmap.org, as an anonymous note</p>
                  <p className="reach-dialog__warn" role="note">
                    This note becomes public on openstreetmap.org and stays visible after it is closed.
                  </p>
                  {error && (
                    <p className="reach-dialog__error" role="alert">
                      {error}
                    </p>
                  )}
                  <div className="reach-dialog__actions">
                    <Button variant="danger" disabled={sending} onClick={() => void post()}>
                      {sending ? "Sending…" : "Post publicly"}
                    </Button>
                    <Button variant="ghost" disabled={sending} onClick={() => setStep("write")}>
                      Back and edit
                    </Button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
