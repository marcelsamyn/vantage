/**
 * The brightest stars: name, right ascension (hours), declination (degrees), apparent magnitude.
 * Source: Yale Bright Star Catalogue (J2000), rounded. Precession since 2000 is under 0.5°, invisible at radar scale.
 */
export const BRIGHT_STARS: readonly [name: string, raH: number, decDeg: number, mag: number][] = [
  ["Sirius", 6.7525, -16.716, -1.46],
  ["Canopus", 6.3992, -52.696, -0.74],
  ["Arcturus", 14.261, 19.182, -0.05],
  ["Rigil Kentaurus", 14.6601, -60.834, -0.01],
  ["Vega", 18.6156, 38.784, 0.03],
  ["Capella", 5.2782, 45.998, 0.08],
  ["Rigel", 5.2423, -8.202, 0.13],
  ["Procyon", 7.655, 5.225, 0.34],
  ["Achernar", 1.6286, -57.237, 0.46],
  ["Betelgeuse", 5.9195, 7.407, 0.5],
  ["Hadar", 14.0637, -60.373, 0.61],
  ["Altair", 19.8464, 8.868, 0.76],
  ["Acrux", 12.4433, -63.099, 0.76],
  ["Aldebaran", 4.5987, 16.509, 0.86],
  ["Antares", 16.4901, -26.432, 0.96],
  ["Spica", 13.4199, -11.161, 0.97],
  ["Pollux", 7.7553, 28.026, 1.14],
  ["Fomalhaut", 22.9608, -29.622, 1.16],
  ["Deneb", 20.6905, 45.28, 1.25],
  ["Mimosa", 12.7953, -59.689, 1.25],
  ["Regulus", 10.1395, 11.967, 1.35],
  ["Adhara", 6.9771, -28.972, 1.5],
  ["Castor", 7.5767, 31.888, 1.58],
  ["Shaula", 17.5601, -37.104, 1.62],
  ["Gacrux", 12.5194, -57.113, 1.63],
  ["Bellatrix", 5.4189, 6.35, 1.64],
  ["Elnath", 5.4382, 28.608, 1.65],
  ["Miaplacidus", 9.22, -69.717, 1.67],
  ["Alnilam", 5.6036, -1.202, 1.69],
  ["Alnair", 22.1372, -46.961, 1.73],
  ["Alnitak", 5.6793, -1.943, 1.74],
  ["Alioth", 12.9005, 55.96, 1.77],
  ["Dubhe", 11.0621, 61.751, 1.79],
  ["Mirfak", 3.4054, 49.861, 1.79],
  ["Wezen", 7.1399, -26.393, 1.83],
  ["Sargas", 17.6219, -42.998, 1.86],
  ["Kaus Australis", 18.4029, -34.385, 1.85],
  ["Avior", 8.3752, -59.51, 1.86],
  ["Alkaid", 13.7923, 49.313, 1.86],
  ["Menkalinan", 5.9921, 44.948, 1.9],
  ["Atria", 16.8111, -69.028, 1.91],
  ["Alhena", 6.6285, 16.399, 1.92],
  ["Peacock", 20.4275, -56.735, 1.94],
  ["Polaris", 2.5303, 89.264, 1.98],
  ["Mirzam", 6.3783, -17.956, 1.98],
  ["Alphard", 9.4598, -8.659, 1.99],
  ["Hamal", 2.1196, 23.462, 2.0],
  ["Algieba", 10.3329, 19.842, 2.01],
  ["Diphda", 0.7265, -17.987, 2.04],
  ["Nunki", 18.921, -26.297, 2.05],
  ["Menkent", 14.1114, -36.37, 2.06],
  ["Alpheratz", 0.1398, 29.091, 2.06],
  ["Mirach", 1.1622, 35.621, 2.07],
  ["Saiph", 5.7959, -9.67, 2.07],
  ["Kochab", 14.8451, 74.156, 2.08],
  ["Rasalhague", 17.5822, 12.56, 2.08],
  ["Algol", 3.1361, 40.956, 2.09],
  ["Almach", 2.065, 42.33, 2.1],
  ["Denebola", 11.8177, 14.572, 2.14],
  ["Navi", 0.9451, 60.717, 2.15],
  ["Schedar", 0.6751, 56.537, 2.24],
  ["Caph", 0.1529, 59.15, 2.28],
  ["Eltanin", 17.9434, 51.489, 2.24],
];

const rad = Math.PI / 180;

/** Local sidereal time in degrees for a longitude, from the Julian date. */
function siderealDeg(date: Date, lonDeg: number): number {
  const jd = date.getTime() / 86_400_000 + 2_440_587.5;
  const d = jd - 2_451_545.0;
  const gmst = 280.46061837 + 360.98564736629 * d;
  return (((gmst + lonDeg) % 360) + 360) % 360;
}

/** Azimuth/elevation of a star for an observer. */
export function starPosition(raH: number, decDeg: number, lat: number, lon: number, date: Date): { az: number; el: number } {
  const ha = (siderealDeg(date, lon) - raH * 15) * rad;
  const dec = decDeg * rad;
  const phi = lat * rad;
  const sinEl = Math.sin(dec) * Math.sin(phi) + Math.cos(dec) * Math.cos(phi) * Math.cos(ha);
  const el = Math.asin(sinEl);
  const y = -Math.sin(ha) * Math.cos(dec);
  const x = Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.sin(phi) * Math.cos(ha);
  const az = (Math.atan2(y, x) / rad + 360) % 360;
  return { az, el: el / rad };
}
