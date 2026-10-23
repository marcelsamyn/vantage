import type { LatLon } from "../../shared/geo";

/**
 * Belgian Lambert 72 (EPSG:31370) to WGS 84. Brussels publishes incident positions in this grid.
 * Lambert conformal conic with two standard parallels on the International 1924 ellipsoid (Snyder, "Map Projections", eq. 15-9 to 15-11),
 * then a three-parameter datum shift to WGS 84 (EPSG:1609 translation). The result is good to a few metres.
 */
const A = 6_378_388;
const F = 1 / 297;
const E2 = 2 * F - F * F;
const E = Math.sqrt(E2);
const RAD = Math.PI / 180;

const PHI1 = 51.166_667_233_333_33 * RAD;
const PHI2 = 49.833_333_9 * RAD;
const LAMBDA0 = 4.367_486_666_666_67 * RAD;
const EASTING0 = 150_000.013;
const NORTHING0 = 5_400_088.438;

const m = (phi: number): number => Math.cos(phi) / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
const t = (phi: number): number => Math.tan(Math.PI / 4 - phi / 2) / ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2);

const N = (Math.log(m(PHI1)) - Math.log(m(PHI2))) / (Math.log(t(PHI1)) - Math.log(t(PHI2)));
const SCALE = (A * m(PHI1)) / (N * t(PHI1) ** N);

/** The false origin is the pole, so the radius there is zero. */
export function lambert72ToWgs84(x: number, y: number): LatLon {
  const dx = x - EASTING0;
  const dy = NORTHING0 - y;
  const rho = Math.hypot(dx, dy);
  const theta = Math.atan2(dx, dy);
  const tPrime = (rho / SCALE) ** (1 / N);
  let phi = Math.PI / 2 - 2 * Math.atan(tPrime);
  for (let i = 0; i < 8; i++) phi = Math.PI / 2 - 2 * Math.atan(tPrime * ((1 - E * Math.sin(phi)) / (1 + E * Math.sin(phi))) ** (E / 2));
  const lambda = theta / N + LAMBDA0;
  return datumShift(phi, lambda);
}

const WGS_A = 6_378_137;
const WGS_F = 1 / 298.257_223_563;
const WGS_E2 = 2 * WGS_F - WGS_F * WGS_F;

function datumShift(phi: number, lambda: number): LatLon {
  const nu = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
  const X = nu * Math.cos(phi) * Math.cos(lambda) - 106.869;
  const Y = nu * Math.cos(phi) * Math.sin(lambda) + 52.2978;
  const Z = nu * (1 - E2) * Math.sin(phi) - 103.724;
  const p = Math.hypot(X, Y);
  let lat = Math.atan2(Z, p * (1 - WGS_E2));
  for (let i = 0; i < 6; i++) {
    const n2 = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(lat) ** 2);
    lat = Math.atan2(Z + WGS_E2 * n2 * Math.sin(lat), p);
  }
  return { lat: lat / RAD, lon: Math.atan2(Y, X) / RAD };
}
