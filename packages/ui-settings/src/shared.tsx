/** Shared settings primitives: controls, layout blocks, formatters. */

import { useEffect, useState } from "react";
import { useTheme, useTokens } from "@vagus/ui-tokens";

export const fmt = (n: number): string => {

  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`;

  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`;

  return String(n);

};

const API_OPTIONS: Array<{ value: string; label: string }> = [

  { value: "openai-completions", label: "OpenAI Completions (/v1/chat/completions)" },

  { value: "openai-responses", label: "OpenAI Responses (/v1/responses)" },

  { value: "anthropic-messages", label: "Anthropic Messages (/v1/messages)" },

  { value: "google-generative-ai", label: "Google Gemini (/v1beta/models)" },

];



export function formatTokens(n: number): string {

  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;

  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;

  return String(n);

}



/** Custom API-format dropdown (native selects misbehave with custom styling). */

export function ApiSelect({ value, onChange, t }: {

  value: string;

  onChange: (value: string) => void;

  t: ReturnType<typeof useTokens>;

}): JSX.Element {

  const [open, setOpen] = useState(false);

  const surfaceBg = useSurfaceBg();

  const current = API_OPTIONS.find((o) => o.value === value)?.label ?? value;

  return (

    <div style={{ position: "relative" }}>

      <button type="button" onClick={() => setOpen((o) => !o)} style={{

        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,

        background: surfaceBg, border: `1px solid ${t.color.border}`,

        borderRadius: 8, padding: "8px 12px", fontSize: 13, color: t.color.fg, cursor: "pointer",

      }}>

        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{current}</span>

        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><path d="M6 9l6 6 6-6"/></svg>

      </button>

      {open && (

        <div style={{

          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,

          background: surfaceBg, border: `1px solid ${t.color.border}`, borderRadius: 10,

          padding: 4, boxShadow: "0 8px 24px rgba(0,0,0,0.25)",

        }}>

          {API_OPTIONS.map((o) => {

            const active = o.value === value;

            return (

              <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }} style={{

                display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",

                border: "none", background: active ? t.color.border : "transparent", color: t.color.fg,

                borderRadius: 7, padding: "7px 10px", fontSize: 12.5, cursor: "pointer", textAlign: "left",

              }}>

                <span>{o.label}</span>

                {active && <span style={{ color: t.color.primary }}>✓</span>}

              </button>

            );

          })}

        </div>

      )}

    </div>

  );

}

export function Field({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {

  const t = useTokens();

  return (

    <div style={{ marginBottom: 16 }}>

      <label style={{ display: "block", fontSize: 12, fontWeight: 500, color: t.color.muted, marginBottom: 6 }}>{label}</label>

      {children}

    </div>

  );

}

export function formatDuration(ms: number): string {

  const hours = Math.floor(ms / 3_600_000);

  const minutes = Math.max(1, Math.floor((ms % 3_600_000) / 60_000));

  if (hours > 0) return `${hours}时${minutes}分`;

  return `${minutes}分`;

}

export function Section({ title, description, children }: {

  title: string;

  description?: string;

  children: React.ReactNode;

}): JSX.Element {

  const { theme } = useTheme();

  const t = useTokens();

  const cardBg = theme === "light" ? "#ffffff" : t.color.surface;

  return (

    <div style={{ marginBottom: 30 }}>

      <div style={{ fontSize: 13, fontWeight: 600, color: t.color.fg, marginBottom: 4 }}>{title}</div>

      {description !== undefined && (

        <div style={{ fontSize: 12, color: t.color.muted, marginBottom: 10, lineHeight: 1.5 }}>{description}</div>

      )}

      <div style={{ background: cardBg, border: `1px solid ${t.color.border}`, borderRadius: 12, overflow: "hidden" }}>

        {children}

      </div>

    </div>

  );

}



/** Surface background: pure white in light mode, token surface in dark mode. */

export function useSurfaceBg(): string {

  const { theme } = useTheme();

  const t = useTokens();

  return theme === "light" ? "#ffffff" : t.color.surface;

}



/** A labeled row with a control on the right (inside a Section card). */

export function SettingRow({ label, hint, control, t, last = false }: {

  label: string;

  hint?: string;

  control: React.ReactNode;

  t: ReturnType<typeof useTokens>;

  last?: boolean;

}): JSX.Element {

  return (

    <div style={{

      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24,

      padding: "13px 18px",

      borderBottom: last ? "none" : `1px solid ${t.color.border}`,

    }}>

      <div style={{ minWidth: 0 }}>

        <div style={{ fontSize: 13, color: t.color.fg }}>{label}</div>

        {hint !== undefined && <div style={{ fontSize: 11.5, color: t.color.muted, marginTop: 3, lineHeight: 1.5 }}>{hint}</div>}

      </div>

      <div style={{ flexShrink: 0 }}>{control}</div>

    </div>

  );

}



/** Segmented single-choice control (浅色 / 深色 / 跟随系统). */

export function Segmented<T extends string>({ options, value, onChange, t }: {

  options: Array<{ value: T; label: string }>;

  value: T;

  onChange: (value: T) => void;

  t: ReturnType<typeof useTokens>;

}): JSX.Element {

  return (

    <div style={{ display: "inline-flex", background: t.color.bg, border: `1px solid ${t.color.border}`, borderRadius: 9, padding: 3, gap: 2 }}>

      {options.map((o) => {

        const active = o.value === value;

        return (

          <button key={o.value} onClick={() => onChange(o.value)} style={{

            border: "none", background: active ? t.color.surface : "transparent",

            color: active ? t.color.fg : t.color.muted,

            borderRadius: 6, padding: "5px 14px", fontSize: 12.5, fontWeight: active ? 500 : 400,

            cursor: "pointer", transition: "all 0.15s", whiteSpace: "nowrap",

          }}>{o.label}</button>

        );

      })}

    </div>

  );

}



/** On/off switch. */

export function Switch({ checked, onChange, t }: {

  checked: boolean;

  onChange: (checked: boolean) => void;

  t: ReturnType<typeof useTokens>;

}): JSX.Element {

  return (

    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)} style={{

      width: 34, height: 20, borderRadius: 99, border: "none", cursor: "pointer", flexShrink: 0,

      background: checked ? t.color.accent : t.color.border, position: "relative", transition: "background 0.15s",

    }}>

      <span style={{

        position: "absolute", top: 2, left: checked ? 16 : 2, width: 16, height: 16, borderRadius: "50%",

        background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,0.25)", transition: "left 0.15s",

      }} />

    </button>

  );

}



/** Numeric stepper with +/− buttons and direct input, `px` suffix. */

export function SizeStepper({ value, onChange, min = 10, max = 20, t }: {

  value: number;

  onChange: (value: number) => void;

  min?: number;

  max?: number;

  t: ReturnType<typeof useTokens>;

}): JSX.Element {

  // Local text state so the user can type freely; committed on blur/Enter and

  // clamped to [min, max]. Synced back when the value changes externally

  // (e.g. via the +/− buttons).

  const [text, setText] = useState(String(value));

  useEffect(() => {

    setText(String(value));

  }, [value]);



  const commit = (raw: string): void => {

    const trimmed = raw.trim();

    if (trimmed === "") {

      setText(String(value));

      return;

    }

    const n = Number(trimmed);

    if (Number.isFinite(n)) {

      onChange(Math.min(max, Math.max(min, Math.round(n))));

    } else {

      setText(String(value));

    }

  };



  const btn: React.CSSProperties = {

    width: 26, height: 30, border: "none", background: "transparent", color: t.color.muted,

    fontSize: 15, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",

  };

  return (

    <div style={{ display: "inline-flex", alignItems: "center", border: `1px solid ${t.color.border}`, borderRadius: 8, overflow: "hidden", background: t.color.bg }}>

      <button onClick={() => onChange(Math.max(min, value - 1))} style={btn} aria-label="减小字号">−</button>

      <input

        type="text"

        inputMode="numeric"

        value={text}

        onChange={(e) => setText(e.target.value.replace(/[^\d]/g, ""))}

        onBlur={() => commit(text)}

        onKeyDown={(e) => {

          if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();

        }}

        aria-label="字号"

        style={{

          width: 40, height: 30, border: "none", outline: "none", textAlign: "center",

          background: "transparent", color: t.color.fg, fontSize: 12.5,

        }}

      />

      <button onClick={() => onChange(Math.min(max, value + 1))} style={btn} aria-label="增大字号">+</button>

      <span style={{ paddingRight: 10, fontSize: 12, color: t.color.muted }}>px</span>

    </div>

  );

}



/** Editor-style code card for the theme preview. */

