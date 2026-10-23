import { Check } from "lucide-react";
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode } from "react";
import type { ChoiceSetting, RangeSetting, SetSetting, SettingOption, SettingSpec, ToggleSetting } from "../../app/core/plugin";
import { sfx } from "../../app/core/sound";
import { Segmented } from "../../app/ui";

/** Controls draw a setting from its spec and report changes; they do not know where the value is kept. */
interface ControlProps<S extends SettingSpec, V> {
  spec: S;
  value: V;
  onChange: (value: V) => void;
}

function Label({ spec, id }: { spec: SettingSpec; id: string }): ReactElement {
  return (
    <span className="settings-label">
      <span className="settings-label__title" id={id}>
        {spec.title}
      </span>
      {spec.description && <span className="settings-label__desc">{spec.description}</span>}
    </span>
  );
}

function Row({ spec, id, stacked, children }: { spec: SettingSpec; id: string; stacked?: boolean; children: ReactNode }): ReactElement {
  return (
    <div className={stacked ? "settings-row settings-row--stacked" : "settings-row"}>
      <Label spec={spec} id={id} />
      {children}
    </div>
  );
}

/** The whole row is the switch, so the target is as large as the text beside it. */
export function ToggleControl({ spec, value, onChange, id }: ControlProps<ToggleSetting, boolean> & { id: string }): ReactElement {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={value}
      aria-labelledby={id}
      className="settings-row settings-row--switch"
      onClick={() => {
        sfx.click();
        onChange(!value);
      }}
    >
      <Label spec={spec} id={id} />
      <span className="settings-switch" aria-hidden />
    </button>
  );
}

function ramp(swatches: readonly string[]): CSSProperties {
  return { "--ramp": `linear-gradient(90deg, ${swatches.join(", ")})` } as CSSProperties;
}

function OptionCard({ option, selected, onSelect }: { option: SettingOption; selected: boolean; onSelect: () => void }): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      // One tab stop for the group, on the chosen card; arrow keys move between cards.
      tabIndex={selected ? 0 : -1}
      className="settings-option"
      onClick={() => {
        sfx.click();
        onSelect();
      }}
    >
      {option.swatches && <span className="settings-option__ramp" style={ramp(option.swatches)} aria-hidden />}
      <span className="settings-option__label">
        {option.label}
        <Check className="settings-option__check" size={13} aria-hidden />
      </span>
      {option.description && <span className="settings-option__desc">{option.description}</span>}
    </button>
  );
}

/** Short bare options become a segmented control; options that explain themselves or show colours become cards. */
export function ChoiceControl<V extends string>({ spec, value, onChange, id }: ControlProps<ChoiceSetting<V>, V> & { id: string }): ReactElement {
  const rich = spec.options.some((o) => o.swatches || o.description);
  if (!rich)
    return (
      <Row spec={spec} id={id}>
        <Segmented value={value} options={spec.options} onChange={onChange} label={spec.title} />
      </Row>
    );
  const step = (e: KeyboardEvent<HTMLDivElement>): void => {
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const n = spec.options.length;
    const at = (spec.options.findIndex((o) => o.value === value) + delta + n) % n;
    const next = spec.options[at];
    if (!next) return;
    onChange(next.value);
    e.currentTarget.querySelectorAll<HTMLButtonElement>("[role=radio]")[at]?.focus();
  };
  return (
    <Row spec={spec} id={id} stacked>
      <div className="settings-options" role="radiogroup" aria-labelledby={id} onKeyDown={step}>
        {spec.options.map((o) => (
          <OptionCard key={o.value} option={o} selected={o.value === value} onSelect={() => onChange(o.value)} />
        ))}
      </div>
    </Row>
  );
}

export function SetControl<V extends string>({ spec, value, onChange, id }: ControlProps<SetSetting<V>, readonly V[]> & { id: string }): ReactElement {
  return (
    <Row spec={spec} id={id} stacked>
      <div className="settings-chips" role="group" aria-labelledby={id}>
        {spec.options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              className="settings-chip"
              onClick={() => {
                sfx.click();
                // Keep the declared order, so the stored list never depends on the order of clicks.
                onChange(spec.options.map((x) => x.value).filter((v) => (v === o.value ? !on : value.includes(v))));
              }}
            >
              <Check size={12} aria-hidden className="settings-chip__check" />
              {o.label}
            </button>
          );
        })}
      </div>
    </Row>
  );
}

function decimals(step: number): number {
  return step >= 1 ? 0 : Math.ceil(-Math.log10(step));
}

export function RangeControl({ spec, value, onChange, id }: ControlProps<RangeSetting, number> & { id: string }): ReactElement {
  const fill = ((value - spec.min) / (spec.max - spec.min)) * 100;
  return (
    <Row spec={spec} id={id}>
      <span className="settings-range">
        <input
          type="range"
          aria-labelledby={id}
          min={spec.min}
          max={spec.max}
          step={spec.step}
          value={value}
          aria-valuetext={`${value.toFixed(decimals(spec.step))}${spec.unit ?? ""}`}
          style={{ "--fill": `${fill}%` } as CSSProperties}
          onChange={(e) => onChange(Number(e.currentTarget.value))}
        />
        <output className="settings-range__value num" aria-hidden>
          {value.toFixed(decimals(spec.step))}
          {spec.unit}
        </output>
      </span>
    </Row>
  );
}
