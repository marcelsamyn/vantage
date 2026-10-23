import { motion } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { usePrefersReducedMotion, type Polled } from "../../app/core/hooks";
import "./dossier.css";

/** One titled section in a place profile, with the register it came from. */
export function FactSection({ title, source, children }: { title: ReactNode; source?: string; children: ReactNode }): ReactElement {
  const reduced = usePrefersReducedMotion();
  return (
    <motion.section
      className="dossier-fact"
      initial={reduced ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", duration: 0.35, bounce: 0 }}
    >
      <h4 className="v-eyebrow dossier-fact__title">{title}</h4>
      {children}
      {source && <div className="dossier-fact__source">{source}</div>}
    </motion.section>
  );
}

/** A line of small facts separated by dots. Empty parts are skipped, and a wrapped line starts with its dot. */
export function Meta({ parts }: { parts: readonly (string | null | false | undefined)[] }): ReactElement {
  return (
    <div className="dossier-item__meta">
      {parts
        .filter((p): p is string => Boolean(p))
        .map((p, i) => (
          <span key={i} className="dossier-item__part">
            {p}
          </span>
        ))}
    </div>
  );
}

/**
 * Shows a section only once the register has answered with something. While loading, and where the register has
 * nothing for the spot, it renders nothing. A failure shows one muted line, so a broken register is not mistaken for an empty one.
 */
export function FactState<T>({
  poll,
  title,
  source,
  children,
}: {
  poll: Polled<T | null>;
  title: ReactNode;
  source: (data: T) => string;
  children: (data: T) => ReactElement | null;
}): ReactElement | null {
  const { data, error } = poll;
  if (data) {
    const body = children(data);
    return body && (
      <FactSection title={title} source={source(data)}>
        {body}
      </FactSection>
    );
  }
  if (error && data === undefined) {
    return (
      <FactSection title={title}>
        <p className="dossier-note">The register did not answer: {error.message}</p>
      </FactSection>
    );
  }
  return null;
}
