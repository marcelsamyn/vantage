export type ScanMode = "vision" | "qr" | "sentry" | "wall";

export type SourceKind = "camera" | "video" | "image";

/** One drawable frame from the active source, plus its size in source pixels. */
export interface Frame {
  el: HTMLVideoElement | HTMLImageElement;
  width: number;
  height: number;
  kind: SourceKind;
  /** Changes whenever the source changes, so engines know to reset. */
  key: string;
}

export type GetFrame = () => Frame | null;

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A rectangle in 0..1 coordinates of the frame. */
export type Zone = Box;

export interface MotionEvent {
  id: string;
  at: number;
  /** Share of the watched area that changed, in percent. */
  amount: number;
  /** JPEG data URL, kept in memory only. */
  thumb: string;
  source: string;
}
