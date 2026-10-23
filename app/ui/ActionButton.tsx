import type { ReactElement } from "react";
import { runAction, type Action } from "../core/action";
import { Button } from "./primitives";

/** An action as a button, or as an anchor when it leads to a page outside VANTAGE. */
export function ActionButton({ action, quiet }: { action: Action; quiet?: boolean }): ReactElement {
  if ("href" in action) {
    return (
      <a className={`v-btn v-btn--sm${quiet ? " v-btn--ghost" : ""}`} href={action.href} target="_blank" rel="noopener noreferrer">
        {action.label}
      </a>
    );
  }
  return (
    <Button size="sm" variant={quiet ? "ghost" : "default"} onClick={() => runAction(action)}>
      {action.label}
    </Button>
  );
}
