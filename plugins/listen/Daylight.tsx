import { Moon, Sun, Sunset } from "lucide-react";
import type { ReactElement } from "react";
import type { Daylight } from "./sun";

export const DAYLIGHT_WORDS: Readonly<Record<Daylight, string>> = { day: "Daytime", twilight: "Twilight", night: "Night" };

export function DaylightIcon({ daylight, size = 14 }: { daylight: Daylight; size?: number }): ReactElement {
  if (daylight === "day") return <Sun size={size} aria-hidden />;
  return daylight === "twilight" ? <Sunset size={size} aria-hidden /> : <Moon size={size} aria-hidden />;
}
