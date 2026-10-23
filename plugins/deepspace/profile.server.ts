import { AU_KM, LIGHT_KM_S, joulePatience, lightTimeWords, powerWords } from "./physics";
import type { DsnLink, SpacecraftProfile, SpacecraftRef, SystemBody } from "./types";

/** Things worth knowing that no feed carries. Dates are the launch and mission facts as the space agencies publish them. */
const STATIC_FACTS: Readonly<Record<number, readonly string[]>> = {
  [-31]: [
    "Voyager 1's transmitter has about 23 W, roughly what a refrigerator light bulb draws.",
    "It launched on 5 September 1977 and crossed into interstellar space in August 2012.",
  ],
  [-32]: [
    "Voyager 2's transmitter has about 23 W, roughly what a refrigerator light bulb draws.",
    "It launched on 20 August 1977 and is the only spacecraft that has flown past Uranus and Neptune.",
  ],
  [-98]: ["New Horizons flew past Pluto on 14 July 2015 and past the icy body Arrokoth on 1 January 2019."],
  [-170]: ["Webb's mirror has 18 gold-coated hexagonal segments and measures 6.5 m across. It sits near the Sun–Earth L2 point, on the side of Earth away from the Sun."],
  [-96]: ["On 24 December 2024 Parker Solar Probe passed 6.1 million km from the Sun's surface at about 692 000 km/h, the fastest any human-made object has travelled."],
  [-61]: ["Juno arrived at Jupiter in July 2016 and has orbited the planet ever since."],
  [-159]: ["Europa Clipper launched on 14 October 2024. It reaches Jupiter in April 2030 to study the ocean under Europa's ice."],
  [-255]: ["Psyche launched on 13 October 2023 toward a metal-rich asteroid, also named Psyche, and arrives in 2029."],
  [-49]: ["Lucy launched on 16 October 2021. It is the first mission to visit the Trojan asteroids that share Jupiter's orbit."],
  [-121]: ["BepiColombo, a joint mission of ESA and JAXA, launched on 20 October 2018 and is due to enter orbit around Mercury in November 2026."],
  [-28]: ["Juice is ESA's mission to Jupiter's icy moons. It launched on 14 April 2023 and reaches Jupiter in July 2031."],
  [-74]: ["Mars Reconnaissance Orbiter has circled Mars since March 2006."],
  [-53]: ["Mars Odyssey has orbited Mars since October 2001, longer than any other spacecraft there."],
  [-144]: ["Solar Orbiter launched in February 2020 and has returned the first images of the Sun's poles."],
  [-91]: ["Hera is ESA's follow-up to NASA's DART mission, which struck the asteroid Dimorphos in 2022. It will study the crater."],
  [-21]: ["SOHO launched in December 1995 and has watched the Sun from the Sun–Earth L1 point ever since."],
};

/** Mean Earth–Moon distance, for scale. */
const MOON_KM = 384_400;
/** Beyond this the Sun-relative speed says something about the trip; closer in, a spacecraft mostly rides along with Earth. */
const DEEP_SPACE_KM = 10_000_000;
const LIGHT_DAY_KM = LIGHT_KM_S * 86_400;

function computedFacts(body: SystemBody, links: readonly DsnLink[]): string[] {
  const facts: string[] = [];
  const au = body.distSunKm / AU_KM;
  if (au > 1.5) facts.push(`Sunlight takes ${lightTimeWords(body.distSunKm / LIGHT_KM_S)} to reach it.`);
  if (body.speedKmS >= 5 && body.distEarthKm > DEEP_SPACE_KM) facts.push(`At ${body.speedKmS.toFixed(1)} km/s it covers the distance from Earth to the Moon in ${lightTimeWords(MOON_KM / body.speedKmS)}.`);
  const toLightDay = LIGHT_DAY_KM - body.distSunKm;
  if (au > 20 && body.radialKmS > 0 && toLightDay > 0) {
    const days = toLightDay / body.radialKmS / 86_400;
    const when = days < 60 ? `${Math.round(days)} days` : days < 730 ? `${Math.round(days / 30.44)} months` : `${(days / 365.25).toFixed(1)} years`;
    facts.push(`It will be one light-day from the Sun in about ${when}.`);
  }
  const power = links.flatMap((l) => l.downlinks).find((s) => s.powerDbm !== null)?.powerDbm;
  if (power !== null && power !== undefined) {
    facts.push(`Its signal reaches the dish at ${powerWords(power)}.`);
    const patience = joulePatience(power);
    if (patience) facts.push(patience);
  }
  return facts;
}

export function buildProfile(spacecraft: SpacecraftRef, body: SystemBody | null, bodyNote: string | null, links: DsnLink[]): SpacecraftProfile {
  const facts = [...(STATIC_FACTS[spacecraft.naifId] ?? []), ...(body ? computedFacts(body, links) : [])];
  return { spacecraft, body, bodyNote, links, facts };
}
