/** Payloads served by /api/webcams: cameras that their operators publish for the public to watch. */

/** "view" is a webcam someone points at a view and shares: a town square, a harbour, a ski slope. */
export type CameraKind = "traffic" | "weather" | "view" | "volcano" | "ocean" | "polar" | "observatory" | "sky";

export interface CameraStream {
  type: "hls" | "mjpeg";
  url: string;
}

export interface Webcam {
  /** Unique across providers: "<provider>:<id>". */
  id: string;
  provider: string;
  providerName: string;
  kind: CameraKind;
  name: string;
  lat: number;
  lon: number;
  /** Latest still image; the same URL is refreshed by the operator. */
  image: string;
  /** Short recent clip, where the operator publishes one. */
  video: string | null;
  /** Live video, where the operator publishes it. */
  stream: CameraStream | null;
  direction: string | null;
  /** Viewing direction in degrees clockwise from north, or null when unknown. */
  bearing: number | null;
  /** How often the operator updates the image, in seconds. */
  refreshS: number;
  /** The operator's licence or attribution line. */
  license: string;
  /** The camera's page at its source. Windy asks that every picture links to it. */
  page: string | null;
  /** IANA time zone of the camera, for cameras in remote places; null for street cameras. */
  tz: string | null;
  /** Side-by-side views in one panorama strip (ocean buoys take six); 1 for an ordinary picture. */
  frames: number;
  /** When the operator took the picture, in ms, when the camera list says so. */
  capturedAt: number | null;
}

export interface CamerasInView {
  cameras: Webcam[];
  truncated: boolean;
  failed: string[];
  providers: string[];
}

/** The cameras nearest a point. When none is close, the wall moves to the nearest covered place. */
export interface CamerasNear {
  /** Where the wall is centred: the requested point, or the nearest camera when the request is far from any. */
  center: { lat: number; lon: number };
  /** Distance in metres from the requested point to the nearest camera, or to the city the wall moved to. */
  nearestM: number;
  /** Name of the place at `center`, when known. */
  place: string | null;
  /** True when the requested point has no camera within the coverage radius and `center` moved. */
  moved: boolean;
  cameras: Webcam[];
  failed: string[];
}

export interface RemoteCameras {
  cameras: Webcam[];
  failed: string[];
}

/** One recent picture taken by a spacecraft. */
export interface OrbitFrame {
  id: string;
  /** The spacecraft, e.g. "GOES-19 (GOES-East)". */
  craft: string;
  operator: string;
  subject: "earth" | "sun";
  title: string;
  /** What the picture shows and how to read it. */
  about: string;
  /** Where the spacecraft is, e.g. "35,786 km above 75.2° W". */
  vantage: string;
  image: string;
  /** A larger picture for the focus view; equals `image` when the source has only one size. */
  imageLarge: string;
  /** When the picture was taken, in ms; null when the source does not say. */
  capturedAt: number | null;
  refreshS: number;
  license: string;
}

export interface OrbitFrames {
  frames: OrbitFrame[];
  failed: string[];
}

export interface RandomCity {
  lat: number;
  lon: number;
  name: string;
}

declare module "../../app/core/plugin" {
  interface EntityKinds {
    webcam: Webcam;
  }
}
