import { motion } from "motion/react";
import type { ReactElement, ReactNode } from "react";
import { Scramble } from "./Scramble";

/**
 * Standard layout for non-map modules: eyebrow, big title, one-line lede, header actions, then content.
 * Children animate in with a short stagger.
 */
export function Page({ eyebrow, title, lede, actions, children }: { eyebrow: string; title: string; lede?: ReactNode; actions?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <div className="v-page v-atmosphere">
      <div className="v-page__inner">
        <header className="v-page__header">
          <div className="v-page__titles">
            <div className="v-eyebrow v-eyebrow--ice">
              <Scramble text={eyebrow} duration={360} />
            </div>
            <h1 className="v-page__title" style={{ marginTop: 10 }}>
              <Scramble text={title} duration={600} delay={60} />
            </h1>
            {lede && (
              <motion.p className="v-page__lede" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.35 }}>
                {lede}
              </motion.p>
            )}
          </div>
          {actions && (
            <motion.div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
              {actions}
            </motion.div>
          )}
        </header>
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, type: "spring", duration: 0.5, bounce: 0 }}>
          {children}
        </motion.div>
      </div>
    </div>
  );
}
