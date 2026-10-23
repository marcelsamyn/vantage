import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { usePrefersReducedMotion } from "../../app/core/hooks";
import { Button } from "../../app/ui";

/**
 * A confirmation that states exactly what will happen before anything is sent.
 * `askConfirm` resolves to true only when the user chooses the action.
 */

interface ConfirmRequest {
  title: string;
  body?: string;
  /** Each thing that will happen, in order. */
  steps?: string[];
  /** Button label naming the action, e.g. "Run shortcut". */
  action: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

const useConfirm = create<{ request: ConfirmRequest | null }>(() => ({ request: null }));

export function askConfirm(request: Omit<ConfirmRequest, "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirm.getState().request?.resolve(false);
    useConfirm.setState({ request: { ...request, resolve } });
  });
}

function close(ok: boolean): void {
  useConfirm.getState().request?.resolve(ok);
  useConfirm.setState({ request: null });
}

/** Render once per screen. The dialog is portalled to the body so no transformed ancestor can shift it. */
export function ConfirmHost(): ReactElement {
  const request = useConfirm((s) => s.request);
  const reduced = usePrefersReducedMotion();
  const titleId = useId();
  const bodyId = useId();

  useEffect(() => {
    if (!request) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") close(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [request]);

  // Close a dialog that is still open when the screen unmounts, so its promise settles.
  useEffect(() => () => close(false), []);

  return createPortal(
    <AnimatePresence>
      {request && (
        <motion.div className="control-confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} onPointerDown={(e) => e.target === e.currentTarget && close(false)}>
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={request.body || request.steps ? bodyId : undefined}
            className={`control-confirm__dialog v-panel v-panel--solid${request.danger ? " control-confirm__dialog--danger" : ""}`}
            initial={reduced ? false : { opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, transition: { duration: 0.12 } }}
            transition={{ type: "spring", duration: 0.35, bounce: 0 }}
          >
            <h2 id={titleId} className="control-confirm__title">
              {request.title}
            </h2>
            <div id={bodyId}>
              {request.body && <p className="control-confirm__body">{request.body}</p>}
              {request.steps && (
                <ol className="control-confirm__steps">
                  {request.steps.map((step, i) => (
                    <li key={step + i}>
                      <span className="control-confirm__step-number num">{String(i + 1).padStart(2, "0")}</span>
                      {step}
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div className="control-confirm__actions">
              {/* Focus starts on Cancel, so a stray Enter never runs anything. */}
              <Button autoFocus variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant={request.danger ? "danger" : "primary"} onClick={() => close(true)}>
                {request.action}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
