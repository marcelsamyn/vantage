import type { ReactElement, SVGProps } from "react";

/** One stroke of a glyph: a path, or a circle as [cx, cy, r]. `fill` draws it solid, for dots. */
export type GlyphMark = { d: string; fill?: true } | { circle: readonly [cx: number, cy: number, r: number]; fill?: true };

/**
 * A glyph drawn on a 24 px grid with square caps, like survey symbols. It is plain data, so a plugin keeps its screen
 * glyph in its own glyph.ts and its manifest can carry it without loading React.
 */
export type Glyph = readonly GlyphMark[];

/** The VANTAGE mark, at the top of the rail. */
export const mark = [{ d: "M5 4.5l7 15 7-15" }, { d: "M1.5 12h3.5M19 12h3.5M12 1.5v3" }] satisfies Glyph;

export function Glyph({ glyph, size = 22, ...rest }: { glyph: Glyph; size?: number } & SVGProps<SVGSVGElement>): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="square" strokeLinejoin="miter" aria-hidden {...rest}>
      {glyph.map((m, i) => {
        const solid = m.fill ? { fill: "currentColor", stroke: "none" } : null;
        return "d" in m ? <path key={i} d={m.d} {...solid} /> : <circle key={i} cx={m.circle[0]} cy={m.circle[1]} r={m.circle[2]} {...solid} />;
      })}
    </svg>
  );
}
