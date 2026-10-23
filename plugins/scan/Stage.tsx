import { useState, type DragEvent, type ReactElement, type ReactNode } from "react";
import { useNow } from "../../app/core/hooks";
import { fmt } from "../../app/core/format";
import { LiveDot } from "../../app/ui";
import type { Source } from "./source";

const KIND_LABEL = { camera: "Your camera", video: "Video file", image: "Image file" } as const;

/**
 * The picture and everything drawn over it. It keeps the picture's own aspect ratio, so overlays
 * can use plain percentages and canvas scaling without letterbox maths.
 */
export function Stage({ source, hidden, children }: { source: Source; hidden: boolean; children?: ReactNode }): ReactElement {
  const { info, size, status } = source;
  const ratio = size ? size.width / size.height : 16 / 9;
  const [dragging, setDragging] = useState(false);
  const now = useNow(1000);

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) source.openFile(file);
  };

  return (
    <div
      className={`scan-stage${hidden ? " scan-stage--hidden" : ""}${dragging ? " scan-stage--drop" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="scan-frame" style={{ aspectRatio: String(ratio), width: `min(100%, calc(60dvh * ${ratio}))` }}>
        <video
          ref={source.videoRef}
          className="scan-media"
          hidden={info?.kind === "image" || !info}
          muted
          loop
          playsInline
          onLoadedMetadata={source.onVideoReady}
        />
        <img ref={source.imageRef} className="scan-media" alt="" hidden={info?.kind !== "image"} onLoad={source.onImageReady} onError={source.onImageError} />

        {!info && <Placeholder starting={status === "starting"} />}
        {info && status === "live" && (
          <>
            <div className="scan-tag scan-tag--source">
              <LiveDot tone="ice" live={info.kind !== "image"} />
              <span>{KIND_LABEL[info.kind]}</span>
              <span className="scan-tag__muted">{info.label}</span>
              {size && <span className="scan-tag__muted num">{size.width}×{size.height}</span>}
            </div>
            <div className="scan-tag scan-tag--clock num">{fmt.clock(now, true)}</div>
          </>
        )}
        {children}
      </div>
    </div>
  );
}

function Placeholder({ starting }: { starting: boolean }): ReactElement {
  return (
    <div className="scan-placeholder">
      <svg className="scan-placeholder__art" viewBox="0 0 120 120" aria-hidden>
        <path d="M14 38V14h24M82 14h24v24M106 82v24H82M38 106H14V82" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="60" cy="60" r="16" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M60 36v12M60 72v12M36 60h12M72 60h12" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="60" cy="60" r="2.5" fill="currentColor" />
      </svg>
      <div className="scan-placeholder__title">{starting ? "Opening source" : "No picture yet"}</div>
      <p className="scan-placeholder__body">{starting ? "Waiting for the first frame." : "Choose your camera or open an image or video file. Every mode works with either."}</p>
      <div className="scan-placeholder__sweep" aria-hidden />
    </div>
  );
}
