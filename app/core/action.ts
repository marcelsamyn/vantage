import { errorMessage } from "./api";
import { feed } from "./feed";
import { go, type Intent } from "./nav";

/**
 * One thing a viewer can do with what they are looking at: open a screen, follow a link out of VANTAGE, or run code.
 * Things near you (`app/core/nearby.ts`) and things on the map (`app/core/things.ts`) both offer actions this way, so
 * every surface shows them with the same button and reports failure the same way.
 *
 *   { label: "Rent now", href: vehicle.rentalUrl }
 *   { label: "Listen", intent: { screen: "listen", action: "nearest" } }
 *   { label: "Walk there", run: () => routeTo(at, "foot") }
 *
 * Name the action in plain words, for what it does. A `href` must be a fixed URL or one the server checked with
 * `webUrl`, never a raw address from an upstream feed.
 */
export type Action = { label: string } & ({ intent: Intent } | { href: string } | { run: () => void | Promise<void> });

/**
 * Carry out an action. A link is left to the browser, so render those with `ActionButton`, which draws an anchor.
 * A failing `run` says so in a toast named after the action, and never throws at the caller.
 */
export function runAction(action: Action): void {
  if ("intent" in action) {
    go(action.intent.screen, { action: action.intent.action, arg: action.intent.arg });
    return;
  }
  if ("run" in action) {
    Promise.resolve()
      .then(action.run)
      .catch((err: unknown) => feed({ level: "alert", source: "core", title: `${action.label} did not work`, detail: errorMessage(err) }, { toast: true }));
  }
}
