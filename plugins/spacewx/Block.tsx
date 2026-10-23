import type { ReactElement, ReactNode } from "react";
import { Empty } from "../../app/ui";
import type { Section } from "./types";
import "./spacewx.css";

/** One titled block of a Sky panel. */
export function Block({ label, note, children }: { label: string; note?: string; children: ReactNode }): ReactElement {
  return (
    <section className="spacewx-block">
      <header className="spacewx-block__head">
        <h3 className="v-eyebrow">{label}</h3>
        {note && <span className="spacewx-block__note">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/** Render a section that may have failed on its own while the rest of the page loaded. */
export function Result<T>({ section, children }: { section: Section<T>; children: (data: T) => ReactNode }): ReactElement {
  if (!section.ok) return <Empty title="Unavailable" tone="error">{section.error}</Empty>;
  return <>{children(section.data)}</>;
}
