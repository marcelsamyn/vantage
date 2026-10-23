import type { Aircraft } from "./types";

export type EmergencyCode = "7700" | "7600" | "7500";

export interface Emergency {
  code: EmergencyCode;
  /** Short name of the situation, as printed on the badge. */
  title: string;
  /** What the code means, in plain words. */
  meaning: string;
  /** What usually happens next. */
  next: string;
}

const EMERGENCIES: Record<EmergencyCode, Omit<Emergency, "code">> = {
  "7700": {
    title: "General emergency",
    meaning: "The crew has told air traffic control that something is wrong. It can be a technical fault, a medical case on board or low fuel.",
    next: "Controllers clear a path and give this flight priority to land at the nearest suitable airport.",
  },
  "7600": {
    title: "Radio failure",
    meaning: "The crew cannot talk to air traffic control by radio. The transponder still works, which is how you can see it here.",
    next: "Fixed lost-communication rules tell the crew which route and altitude to fly and where to land. Controllers know the rules and keep other traffic away.",
  },
  "7500": {
    title: "Unlawful interference",
    meaning: "This is the hijack code. Pilots sometimes dial it by mistake while setting another code, so on its own it proves nothing.",
    next: "Controllers avoid calling the aircraft on the radio, in case someone is listening. They check other signs before they act.",
  },
};

/** The transponder code that makes an aircraft an emergency. The ADS-B emergency field is the fallback when the squawk is not set. */
export function emergencyOf(a: Pick<Aircraft, "squawk" | "emergency">): Emergency | null {
  const code = codeOf(a);
  return code ? { code, ...EMERGENCIES[code] } : null;
}

function codeOf(a: Pick<Aircraft, "squawk" | "emergency">): EmergencyCode | null {
  if (a.squawk === "7700" || a.squawk === "7600" || a.squawk === "7500") return a.squawk;
  // "lifeguard" (a medical flight) and "minfuel" (an advisory) are not distress calls.
  switch (a.emergency) {
    case "general":
      return "7700";
    case "nordo":
      return "7600";
    case "unlawful":
      return "7500";
    default:
      return null;
  }
}
