import type { PluginId } from "../../plugins";

/**
 * The four screens a phone reaches with one tap. Briefing and City answer "what is around me"; Sky and Scan use what
 * only a phone in the hand does well, looking up at the sky and pointing a camera. They are also the screens on
 * hotkeys 1 to 4 and the shortcuts on the home-screen icon. Every other screen is one tap away under More.
 */
export const TABS = ["home", "city", "sky", "scan"] as const satisfies readonly PluginId[];
