import { motion } from "motion/react";
import { useId, type ButtonHTMLAttributes, type CSSProperties, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { sfx } from "../core/sound";

export type Tone = "ice" | "sodium" | "alarm" | "mint";
const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(" ");

// ── Panel ─────────────────────────────────────────────────────────

export function Panel({
  title,
  actions,
  children,
  flush,
  solid,
  active,
  className,
  style,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  flush?: boolean;
  solid?: boolean;
  active?: boolean;
  className?: string;
  style?: CSSProperties;
}): ReactElement {
  return (
    <section className={cx("v-panel", solid && "v-panel--solid", active && "v-panel--active", className)} style={style}>
      {(title !== undefined || actions) && (
        <header className="v-panel__head">
          <h2 className="v-eyebrow">{title}</h2>
          {actions}
        </header>
      )}
      <div className={cx("v-panel__body", flush && "v-panel__body--flush")}>{children}</div>
    </section>
  );
}

export function Eyebrow({ children, tone, className }: { children: ReactNode; tone?: "ice" | "sodium"; className?: string }): ReactElement {
  return <div className={cx("v-eyebrow", tone && `v-eyebrow--${tone}`, className)}>{children}</div>;
}

// ── Stat ──────────────────────────────────────────────────────────

export function Stat({
  label,
  value,
  unit,
  hint,
  size = "md",
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  size?: "sm" | "md" | "lg";
  tone?: Tone;
}): ReactElement {
  return (
    <div className={cx("v-stat", size !== "md" && `v-stat--${size}`)}>
      <div className="v-eyebrow">{label}</div>
      <div className={cx("v-stat__value", tone)}>
        {value}
        {unit && <span className="v-stat__unit">{unit}</span>}
      </div>
      {hint && <div className="v-stat__hint">{hint}</div>}
    </div>
  );
}

/** A label/value pair. Falsy entries are skipped, so rows can be written as `cond && ["Label", value]`. */
export type Row = readonly [ReactNode, ReactNode];
export type MaybeRow = Row | null | undefined | false | "" | 0;

export function Readout({ rows, className }: { rows: MaybeRow[]; className?: string }): ReactElement {
  return (
    <dl className={cx("v-readout", className)}>
      {rows.filter((r): r is Row => Boolean(r)).map(([k, v], i) => (
        <div key={i} style={{ display: "contents" }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Buttons ───────────────────────────────────────────────────────

type ButtonVariant = "default" | "primary" | "ghost" | "danger";

export function Button({
  variant = "default",
  size = "md",
  on,
  icon,
  children,
  className,
  onClick,
  ...rest
}: { variant?: ButtonVariant; size?: "sm" | "md"; on?: boolean; icon?: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  return (
    <button
      type="button"
      className={cx("v-btn", variant !== "default" && `v-btn--${variant}`, size === "sm" && "v-btn--sm", on && "v-btn--on", className)}
      onClick={(e) => {
        sfx.click();
        onClick?.(e);
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ label, on, children, className, onClick, ...rest }: { label: string; on?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>): ReactElement {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx("v-iconbtn", on && "v-iconbtn--on", className)}
      onClick={(e) => {
        sfx.click();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── Segmented control ─────────────────────────────────────────────

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; label: string }): ReactElement {
  const id = useId();
  return (
    <div className="v-seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className="v-seg__item"
          onClick={() => {
            if (o.value !== value) sfx.click();
            onChange(o.value);
          }}
        >
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="v-seg__pill" transition={{ type: "spring", duration: 0.3, bounce: 0 }} />}
          <span className="v-seg__label">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

// ── Toggle row ────────────────────────────────────────────────────

export function Toggle({ checked, onChange, label, count, swatch }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; count?: ReactNode; swatch?: string }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="v-toggle"
      style={swatch ? ({ "--swatch": swatch } as CSSProperties) : undefined}
      onClick={() => {
        sfx.click();
        onChange(!checked);
      }}
    >
      {swatch && <span className="v-swatch" />}
      <span className="v-toggle__label">{label}</span>
      {count !== undefined && <span className="v-toggle__count">{count}</span>}
      <span className="v-toggle__switch" />
    </button>
  );
}

// ── Input ─────────────────────────────────────────────────────────

export function Input({ prompt = "›", className, trailing, ...rest }: { prompt?: ReactNode; trailing?: ReactNode } & InputHTMLAttributes<HTMLInputElement>): ReactElement {
  return (
    <label className={cx("v-input", className)}>
      <span className="v-input__prompt" aria-hidden>
        {prompt}
      </span>
      <input spellCheck={false} autoComplete="off" {...rest} />
      {trailing}
    </label>
  );
}

// ── Small things ──────────────────────────────────────────────────

export function Tag({ children, tone, className }: { children: ReactNode; tone?: Tone; className?: string }): ReactElement {
  return <span className={cx("v-tag", tone && `v-tag--${tone}`, className)}>{children}</span>;
}

export function LiveDot({ tone = "ice", live = true }: { tone?: Tone; live?: boolean }): ReactElement {
  return <span className={cx("v-dot", live && "v-dot--live", tone)} aria-hidden />;
}

export function Meter({ value, max = 1, tone, ticks }: { value: number; max?: number; tone?: Tone | string; ticks?: boolean }): ReactElement {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = tone && ["ice", "sodium", "alarm", "mint"].includes(tone) ? `var(--${tone})` : tone;
  return (
    <div className={cx("v-meter", ticks && "v-meter--ticks")} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div className="v-meter__fill" style={{ width: `${pct}%`, ...(color ? ({ "--meter": color } as CSSProperties) : {}) }} />
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }): ReactElement {
  return <kbd className="v-kbd">{children}</kbd>;
}

export function Scanning({ label = "Scanning" }: { label?: string }): ReactElement {
  return (
    <span className="v-scanning" role="status">
      <span className="v-scanning__bar" />
      {label}
    </span>
  );
}

/** Empty, permission and error states: say what happened and what to do. */
export function Empty({
  title,
  children,
  action,
  tone,
  center,
}: {
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  tone?: "error";
  center?: boolean;
}): ReactElement {
  return (
    <div className={cx("v-empty", tone === "error" && "v-empty--error", center && "v-empty--center")}>
      <div className="v-empty__title">{title}</div>
      {children && <div className="v-empty__body">{children}</div>}
      {action}
    </div>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────

export function Sparkline({
  values,
  max,
  min = 0,
  tone = "ice",
  height = 36,
  width = 160,
  fill = true,
}: {
  values: readonly number[];
  max?: number;
  min?: number;
  tone?: Tone;
  height?: number;
  width?: number;
  fill?: boolean;
}): ReactElement {
  const top = max ?? Math.max(min + 1e-9, ...values);
  const n = Math.max(2, values.length);
  const pts = values.map((v, i) => [(i / (n - 1)) * width, height - ((Math.min(top, Math.max(min, v)) - min) / (top - min)) * (height - 2) - 1] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
  const last = pts[pts.length - 1];
  const gradId = useId();
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={`var(--${tone})`} stopOpacity="0.28" />
          <stop offset="1" stopColor={`var(--${tone})`} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && pts.length > 1 && last && <path d={`${line}L${last[0]},${height}L0,${height}Z`} fill={`url(#${gradId})`} />}
      {pts.length > 1 && <path d={line} fill="none" stroke={`var(--${tone})`} strokeWidth="1.25" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
