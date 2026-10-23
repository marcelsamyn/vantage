import { CircleHelp, Laptop, Lightbulb, Music2, Plug, Printer, Router, Speaker, SquareStack, Tv, type LucideIcon } from "lucide-react";
import type { DeviceKind } from "./types";

/** How each kind of device is named and drawn. */
export const KIND: Record<DeviceKind, { label: string; icon: LucideIcon }> = {
  computer: { label: "Computer", icon: Laptop },
  player: { label: "Media player", icon: Music2 },
  automation: { label: "Automation", icon: SquareStack },
  hub: { label: "Bridge", icon: Router },
  light: { label: "Light", icon: Lightbulb },
  printer: { label: "Printer", icon: Printer },
  speaker: { label: "Speaker", icon: Speaker },
  tv: { label: "TV", icon: Tv },
  plug: { label: "Plug", icon: Plug },
  other: { label: "Device", icon: CircleHelp },
};
