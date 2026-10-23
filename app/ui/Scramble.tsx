import { useEffect, useRef, type ReactElement } from "react";
import { usePrefersReducedMotion } from "../core/hooks";

const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&/<>=+";

/**
 * Text that "decrypts" into place, left to right. Re-runs whenever `text` changes.
 * Writes straight to the DOM node, so animating never re-renders React.
 */
export function Scramble({ text, duration = 520, delay = 0, className }: { text: string; duration?: number; delay?: number; className?: string }): ReactElement {
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced || text.length === 0) {
      node.textContent = text;
      return;
    }
    const chars = [...text];
    const resolveAt = chars.map((_, i) => (i / Math.max(1, chars.length)) * duration * 0.75 + Math.random() * duration * 0.25);
    let raf = 0;
    const start = performance.now() + delay;
    const frame = (now: number): void => {
      const t = now - start;
      let out = "";
      let done = true;
      for (let i = 0; i < chars.length; i++) {
        const ch = chars[i] ?? "";
        if (t >= (resolveAt[i] ?? 0) || ch === " ") out += ch;
        else {
          done = false;
          out += t < 0 ? " " : (GLYPHS[Math.floor(Math.random() * GLYPHS.length)] ?? "#");
        }
      }
      node.textContent = out;
      if (!done) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [text, duration, delay, reduced]);

  return (
    <span ref={ref} className={className} aria-label={text}>
      {text}
    </span>
  );
}
