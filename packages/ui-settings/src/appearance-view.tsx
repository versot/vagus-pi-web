/** Appearance settings (theme + code display). */

import { useTheme } from "@vagus/ui-tokens";
import type { useTokens } from "@vagus/ui-tokens";
import type { AppearanceSettings } from "@vagus/ui-tokens";
import { codePaletteFor, highlightLine } from "@vagus/ui-shared";
import { Section, SettingRow, Segmented, Switch, SizeStepper } from "./shared.js";

const CODE_SAMPLE_LINES = [

  "const themePreview: ThemeConfig = {",

  '  surface: "sidebar",',

  '  accent: "#339CFF",',

  "  contrast: 45,",

  "};",

];



/** Card section: title (with optional description) above a bordered container. */

export function CodePreviewCard({ title, themeName, dark, active, showLineNumbers, codeFontSize, t }: {

  title: string;

  themeName: string;

  dark: boolean;

  active: boolean;

  showLineNumbers: boolean;

  codeFontSize: number;

  t: ReturnType<typeof useTokens>;

}): JSX.Element {

  // The preview reflects the *draft* code theme and font size, so switching

  // 浅色/深色代码主题 or 代码字号 updates the matching card immediately —

  // without touching the live settings until the page is closed.

  const pal = codePaletteFor(themeName);

  const status = active ? "当前生效" : dark ? "深色" : "浅色";

  return (

    <div style={{

      flex: "1 1 300px", background: pal.bg, border: `1px solid ${pal.border}`,

      borderRadius: 12, overflow: "hidden",

      boxShadow: active ? `0 0 0 1.5px ${t.color.accent}` : "none",

    }}>

      <div style={{

        display: "flex", alignItems: "center", justifyContent: "space-between",

        padding: "8px 14px", background: pal.header, borderBottom: `1px solid ${pal.border}`,

      }}>

        <span style={{ fontSize: 12, color: pal.text, opacity: 0.85 }}>{title}</span>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>

          <span style={{ fontSize: 11, color: pal.text, opacity: 0.6 }}>{themeName}</span>

          <span style={{

            fontSize: 11, fontWeight: 500,

            color: active ? "#fff" : pal.text,

            background: active ? t.color.accent : "transparent",

            border: active ? "none" : `1px solid ${pal.border}`,

            borderRadius: 99, padding: "2px 10px",

          }}>{status}</span>

        </div>

      </div>

      <div style={{ padding: "12px 0 14px", fontSize: codeFontSize, lineHeight: 1.65, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: pal.text }}>

        {CODE_SAMPLE_LINES.map((ln, i) => (

          <div key={i} style={{ display: "flex", paddingLeft: 16, paddingRight: 16 }}>

            {showLineNumbers && (

              <span style={{ width: 26, flexShrink: 0, textAlign: "right", marginRight: 14, color: pal.text, opacity: 0.35, userSelect: "none" }}>{i + 1}</span>

            )}

            <span style={{ whiteSpace: "pre" }}>

              {highlightLine(ln, pal).map((tok, j) =>

                tok.color !== undefined ? (

                  <span key={j} style={{ color: tok.color }}>{tok.text}</span>

                ) : (

                  tok.text

                ),

              )}

            </span>

          </div>

        ))}

      </div>

    </div>

  );

}



/** 外观 — theme + interface/code font settings (appearance). */

export function AppearanceView({ draft, onChange, t }: {

  draft: AppearanceSettings;

  onChange: (patch: Partial<AppearanceSettings>) => void;

  t: ReturnType<typeof useTokens>;

}): JSX.Element {

  // The theme applies immediately (live), while font/display settings stay in

  // the draft and only land on the main view when the settings page closes.

  const { theme, preference, setPreference } = useTheme();



  return (

    <>

      <div style={{ fontSize: 22, fontWeight: 600, color: t.color.fg }}>外观</div>

      <div style={{ marginTop: 24 }}>

      <Section title="界面设置" description="设置应用主题和界面文字大小。">

        <SettingRow

          label="界面主题"

          hint="选择浅色、深色或跟随系统主题。"

          control={

            <Segmented

              options={[

                { value: "light", label: "浅色" },

                { value: "dark", label: "深色" },

                { value: "system", label: "跟随系统" },

              ]}

              value={preference}

              onChange={setPreference}

              t={t}

            />

          }

          t={t}

        />

        <SettingRow

          label="界面字号"

          hint="调整应用界面的文字大小，图标和布局尺寸不受影响。"

          last

          control={<SizeStepper value={draft.uiFontSize} onChange={(v) => onChange({ uiFontSize: v })} t={t} />}

          t={t}

        />

      </Section>



      <Section title="代码设置" description="设置代码内容的主题、字号和显示方式，不受界面字号影响。">

        <SettingRow

          label="显示行号"

          hint="在代码内容和差异视图中显示行号。"

          control={<Switch checked={draft.showLineNumbers} onChange={(v) => onChange({ showLineNumbers: v })} t={t} />}

          t={t}

        />

        <SettingRow

          label="长行自动换行"

          hint="代码内容过长时自动换行。"

          control={<Switch checked={draft.wrapLongLines} onChange={(v) => onChange({ wrapLongLines: v })} t={t} />}

          t={t}

        />

        <SettingRow

          label="代码字号"

          hint="调整代码块、文件预览和差异视图的默认字号。"

          last

          control={<SizeStepper value={draft.codeFontSize} onChange={(v) => onChange({ codeFontSize: v })} min={10} max={24} t={t} />}

          t={t}

        />

      </Section>



      <Section title="代码预览" description="同时预览浅色与深色代码主题，当前界面使用的主题会标记为“当前生效”。">

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: 18 }}>

          <CodePreviewCard

            title="浅色预览"

            themeName="GitHub Light"

            dark={false}

            active={theme === "light"}

            showLineNumbers={draft.showLineNumbers}

            codeFontSize={draft.codeFontSize}

            t={t}

          />

          <CodePreviewCard

            title="深色预览"

            themeName="GitHub Dark"

            dark

            active={theme === "dark"}

            showLineNumbers={draft.showLineNumbers}

            codeFontSize={draft.codeFontSize}

            t={t}

          />

        </div>

      </Section>

      </div>

    </>

  );

}
