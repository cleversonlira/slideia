import { useEffect, useRef, useState, type ReactNode } from "react";
import { COLOR_TOKENS, isHex, resolveTheme, type Presentation } from "@apresenta/core/browser";
import { COLOR_LABELS } from "./defaults.js";
import { allIcons } from "./deck.js";

export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const inner = allIcons()[name] ?? "";
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}

export function IconButton(props: {
  icon: string;
  label: string;
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  keepFocus?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`icon-btn ${props.active ? "on" : ""} ${props.className ?? ""}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onMouseDown={props.keepFocus ? (e) => e.preventDefault() : undefined}
      onClick={props.onClick}
    >
      <Icon name={props.icon} />
      {props.children}
    </button>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/** Text input that commits on blur/Enter (avoids one undo step per keystroke). */
export function TextInput(props: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  ariaLabel?: string;
}) {
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => {
    if (v !== props.value) props.onCommit(v);
  };
  const common = {
    value: v,
    placeholder: props.placeholder,
    maxLength: props.maxLength,
    "aria-label": props.ariaLabel,
    onChange: (e: { target: { value: string } }) => setV(e.target.value),
    onBlur: commit,
  };
  return props.multiline ? (
    <textarea {...common} rows={3} />
  ) : (
    <input
      type="text"
      {...common}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(props.value);
      }}
    />
  );
}

export function Select<T extends string>(props: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  ariaLabel?: string;
}) {
  return (
    <select
      value={props.value}
      aria-label={props.ariaLabel}
      onChange={(e) => props.onChange(e.target.value as T)}
    >
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input, button, select, textarea")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="x" label="Fechar (Esc)" onClick={onClose} />
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/** Theme color tokens as swatches, plus a custom color. */
export function ColorPicker(props: {
  pres: Presentation;
  value: string | undefined;
  onChange: (color: string | null) => void;
  tokens?: readonly string[];
  allowNone?: boolean;
  keepFocus?: boolean;
}) {
  const theme = resolveTheme(props.pres.meta);
  const tokens = props.tokens ?? COLOR_TOKENS;
  const prevent = props.keepFocus
    ? (e: { preventDefault: () => void }) => e.preventDefault()
    : undefined;
  return (
    <div className="color-picker">
      {props.allowNone && (
        <button
          type="button"
          className={`swatch none ${!props.value ? "on" : ""}`}
          title="Padrão"
          onMouseDown={prevent}
          onClick={() => props.onChange(null)}
        >
          <Icon name="ban" size={14} />
        </button>
      )}
      {tokens.map((t) => (
        <button
          type="button"
          key={t}
          className={`swatch ${props.value === t ? "on" : ""}`}
          title={COLOR_LABELS[t] ?? t}
          style={{ background: (theme.colors as unknown as Record<string, string>)[t] }}
          onMouseDown={prevent}
          onClick={() => props.onChange(t)}
        />
      ))}
      <label className="swatch custom" title="Cor personalizada" onMouseDown={prevent}>
        <input
          type="color"
          value={props.value && isHex(props.value) ? props.value : "#888888"}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <Icon name="pipette" size={14} />
      </label>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Menu({
  trigger,
  children,
}: {
  trigger: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      {trigger(() => setOpen((o) => !o))}
      {open && <div className="menu">{children(() => setOpen(false))}</div>}
    </div>
  );
}
