import type { Driver } from "../driver.server";
import { hue } from "./hue.server";
import { mac } from "./mac.server";
import { media } from "./media.server";
import { printer } from "./printer.server";
import { shortcuts } from "./shortcuts.server";

/** Every device driver. Add a new device type by writing one driver file and listing it here. */
export const DRIVERS: readonly Driver[] = [mac, media, shortcuts, hue, printer];
