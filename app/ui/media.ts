import { useSyncExternalStore } from "react";

/** Phone layout: the rail turns into a bottom tab bar and profiles open as bottom sheets. Matches the CSS breakpoint in shell.css. */
export const PHONE = "(max-width: 720px)";

/** Whether a media query matches now; re-renders when the answer changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => matchMedia(query).matches,
  );
}
