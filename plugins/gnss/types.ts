/** Payloads served by /api/gnss: GPS interference from gpsjam.org and the Galileo constellation status. */

export type JamLevel = "some" | "heavy";

export interface JamCellProps {
  /** Share of the day's aircraft that reported poor navigation accuracy, percent. */
  share: number;
  badAircraft: number;
  goodAircraft: number;
  level: JamLevel;
}

export type JamCells = GeoJSON.FeatureCollection<GeoJSON.Polygon, JamCellProps>;

export interface Jamming {
  /** The UTC day the map covers, YYYY-MM-DD. */
  date: string;
  /** gpsjam.org marks days with incomplete or doubtful data. */
  suspect: boolean;
  cells: JamCells;
  /** Cells that had aircraft in them, including quiet ones. */
  cellsWithTraffic: number;
}

export type SatelliteHealth = "healthy" | "testing" | "unhealthy" | "unknown";

export interface GalileoSatellite {
  /** Satellite name, e.g. "GSAT0101". */
  name: string;
  /** Signal identifier, e.g. "E11". */
  svid: string;
  clock: string;
  health: SatelliteHealth;
  /** Status exactly as the service centre words it. */
  statusText: string;
  /** Number of the notice that explains the status, when there is one. */
  nagu: string | null;
  subject: string | null;
}

export interface GalileoNotice {
  /** NAGU number, e.g. "2026046". */
  id: string;
  subject: string;
  type: string | null;
  /** Unix seconds. */
  published: number;
  start: number | null;
  end: number | null;
  affected: string | null;
  url: string;
}

export interface GalileoStatus {
  satellites: GalileoSatellite[];
  notices: GalileoNotice[];
}
