import { AnimatePresence } from "motion/react";
import { Download, X } from "lucide-react";
import { useMemo, type ReactElement } from "react";
import { fmt } from "../../app/core/format";
import { useNow, usePrefersReducedMotion } from "../../app/core/hooks";
import { Button, Empty, Panel, ProfilerCard, Scanning, Stat, Tag } from "../../app/ui";
import { colorOf, dwellText, drawHud, easeTracks, hitTrack, readInk, type Ink } from "./hud";
import { OverlayCanvas, type DrawFn } from "./Overlay";
import { groupOf, profileOf } from "./profiles";
import type { Track } from "./tracker";
import type { Frame, GetFrame } from "./types";
import type { Vision } from "./vision-engine";

export function VisionLayer({ vision, getFrame, hasPicture, selectedId, onSelect }: { vision: Vision; getFrame: GetFrame; hasPicture: boolean; selectedId: number | null; onSelect: (id: number | null) => void }): ReactElement {
  const ink = useMemo(readInk, []);
  const reduced = usePrefersReducedMotion();
  const { stats, status } = vision;

  const draw: DrawFn = (ctx, w, _h, now, dt) => {
    const frame = getFrame();
    if (!frame) return;
    easeTracks(vision.tracksRef.current, dt);
    drawHud(ctx, vision.tracksRef.current, { sx: w / frame.width, width: w, unit: 1, now, ink, selectedId, live: frame.kind !== "image", animate: !reduced });
  };

  const pick = (x: number, y: number, width: number): void => {
    const frame = getFrame();
    if (!frame) return;
    onSelect(hitTrack(vision.tracksRef.current, x, y, width / frame.width, performance.now(), frame.kind !== "image")?.id ?? null);
  };

  return (
    <>
      <OverlayCanvas draw={draw} onPick={pick} label="Detected objects, drawn over the picture" active={hasPicture} />
      {status === "loading" && (
        <div className="scan-banner" role="status">
          <Scanning label="Loading detection model" />
          <p>The model (about 2 MB) downloads from Google's servers the first time you use Vision. Your browser keeps it afterwards. Only the model file is downloaded. No picture leaves this Mac.</p>
        </div>
      )}
      {status === "error" && (
        <div className="scan-banner scan-banner--error">
          <Empty title="Detection model did not load" tone="error" action={<Button onClick={vision.retry}>Try again</Button>}>
            {vision.error ?? "The download failed."} Check your internet connection. The model downloads once and is cached.
          </Empty>
        </div>
      )}
      {status === "ready" && stats.people + stats.vehicles + stats.objects === 0 && (
        <div className="scan-banner scan-banner--quiet">
          <Scanning label="Scanning" />
        </div>
      )}
    </>
  );
}

function Dwell({ track }: { track: Track }): ReactElement {
  useNow(1000);
  return <span className="num">{dwellText(track, performance.now()).toLowerCase()}</span>;
}

function ObjectProfile({ track, onClose }: { track: Track; onClose: () => void }): ReactElement {
  const profile = profileOf(track.cls);
  const group = groupOf(track.cls);
  return (
    <ProfilerCard
      key={track.id}
      band="Object profile"
      name={track.cls.replace(/^./, (c) => c.toUpperCase())}
      kicker={`Track #${String(track.id).padStart(2, "0")}`}
      tone={group === "vehicle" ? "sodium" : "ice"}
      rows={[
        ["Occupation", profile?.occupation ?? "unknown"],
        ["Confidence", <span key="c" className="num">{Math.round(track.score * 100)}%</span>],
        ["In view", <Dwell key="d" track={track} />],
      ]}
      fact={profile?.fact}
      source="Detected on this Mac · COCO-SSD"
      onClose={onClose}
    />
  );
}

export function VisionPanel({ vision, selectedId, onSelect, getFrame, hasPicture }: { vision: Vision; selectedId: number | null; onSelect: (id: number | null) => void; getFrame: GetFrame; hasPicture: boolean }): ReactElement {
  const { stats, tracksRef, status } = vision;
  const selected = selectedId === null ? null : (tracksRef.current.find((t) => t.id === selectedId) ?? null);
  const ink = useMemo(readInk, []);

  return (
    <>
      <Panel
        title="Vision"
        actions={
          <Tag tone={hasPicture && status === "ready" ? "mint" : undefined}>
            {!hasPicture || status === "idle" ? "Idle" : status === "loading" ? "Loading" : status === "error" ? "Error" : stats.fps > 0 ? `${stats.fps} fps` : "Ready"}
          </Tag>
        }
      >
        <div className="scan-counters">
          <Stat label="People" value={stats.people} tone="ice" size="lg" />
          <Stat label="Vehicles" value={stats.vehicles} tone="sodium" size="lg" />
          <Stat label="Objects" value={stats.objects} size="lg" />
        </div>
        <p className="scan-note">
          Counts are boxes in view right now. {hasPicture ? "Click a box for its profile." : "Open a picture to start detecting."}
        </p>
        <div className="scan-actions">
          <Button variant="primary" icon={<Download size={14} />} disabled={!hasPicture || status !== "ready"} onClick={() => void capture(getFrame(), tracksRef.current, selectedId, ink)}>
            Capture annotated PNG
          </Button>
        </div>
      </Panel>
      <AnimatePresence mode="wait">
        {selected && (
          <div key={selected.id} className="scan-profile">
            <ObjectProfile track={selected} onClose={() => onSelect(null)} />
          </div>
        )}
      </AnimatePresence>
      {selectedId !== null && !selected && (
        <Empty title="Out of view">
          That object left the picture. Pick another box.
          <Button size="sm" variant="ghost" icon={<X size={12} />} onClick={() => onSelect(null)}>
            Dismiss
          </Button>
        </Empty>
      )}
      <Legend ink={ink} />
    </>
  );
}

function Legend({ ink }: { ink: Ink }): ReactElement {
  return (
    <ul className="scan-legend" aria-label="Colour key">
      {(["person", "car", "cup"] as const).map((cls) => (
        <li key={cls}>
          <i style={{ background: colorOf(cls, ink) }} />
          {cls === "person" ? "People" : cls === "car" ? "Vehicles" : "Everything else"}
        </li>
      ))}
    </ul>
  );
}

/** Save the current picture with its boxes drawn on, at the picture's own resolution. */
async function capture(frame: Frame | null, tracks: Track[], selectedId: number | null, ink: Ink): Promise<void> {
  if (!frame) return;
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(frame.el, 0, 0);
  const unit = Math.max(1, frame.width / 900);
  drawHud(ctx, tracks, { sx: 1, width: frame.width, unit, now: performance.now(), ink, selectedId, live: frame.kind !== "image", animate: false });
  ctx.font = `500 ${10.5 * unit}px "Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = "rgba(230, 236, 240, 0.8)";
  ctx.textAlign = "right";
  ctx.fillText(`VANTAGE · SCAN · ${new Date().toLocaleString("sv")}`, frame.width - 12 * unit, frame.height - 12 * unit);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vantage-scan-${fmt.clock(Date.now(), true).replace(/:/g, "")}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
