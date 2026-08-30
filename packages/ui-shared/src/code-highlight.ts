/**
 * Code syntax highlighting for the GitHub Light / GitHub Dark palettes.
 *
 * Pure logic (no React): renderers in ui-chat (markdown) and ui-settings
 * (appearance preview) map the returned tokens to styled spans. The palettes
 * mirror the GitHub Light / GitHub Dark editor color schemes.
 */

export type CodeThemeName = "GitHub Light" | "GitHub Dark";

export interface CodePalette {
  bg: string;
  header: string;
  border: string;
  text: string;
  keyword: string;
  fn: string;
  type: string;
  prop: string;
  str: string;
}

export const LIGHT_PALETTE: CodePalette = {
  bg: "#ffffff",
  header: "#f6f8fa",
  border: "#d0d7de",
  text: "#24292f",
  keyword: "#cf222e",
  fn: "#8250df",
  type: "#953800",
  prop: "#0550ae",
  str: "#0a3069",
};

export const DARK_PALETTE: CodePalette = {
  bg: "#0d1117",
  header: "#161b22",
  border: "#30363d",
  text: "#c9d1d9",
  keyword: "#ff7b72",
  fn: "#d2a8ff",
  type: "#ffa657",
  prop: "#79c0ff",
  str: "#a5d6ff",
};

/** Resolves a code theme name to its palette (unknown names fall back to dark). */
export function codePaletteFor(themeName: string): CodePalette {
  return themeName === "GitHub Light" ? LIGHT_PALETTE : DARK_PALETTE;
}

/** A highlighted fragment of a code line: plain text, or text with a color. */
export interface CodeToken {
  text: string;
  color?: string;
}

/**
 * Splits a single line of code into colored tokens.
 *
 * Regex alternative order matters: strings first (so `"..."` never leaks),
 * then identifiers followed by `: Type` (function names), then keywords,
 * then `key:` (object properties), then capital-type names, then hex colors
 * and numbers.
 */
export function highlightLine(code: string, pal: CodePalette): CodeToken[] {
  const out: CodeToken[] = [];
  const re =
    /("(?:[^"\\]|\\.)*")|([a-zA-Z_$][\w$]*)(?=\s*:\s*[A-Z][A-Za-z0-9]*)|\b(const|let|var|function|return|import|export|from|new|type|interface|extends|async|await)\b|([a-zA-Z_$][\w$]*)(?=\s*:)|#[0-9a-fA-F]{3,8}\b|\b(?:true|false|null|undefined)\b|\b\d+(?:\.\d+)?\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    if (m.index > last) out.push({ text: code.slice(last, m.index) });
    const [, str, fn, kw, prop, hex, literal, num] = m;
    if (str !== undefined) out.push({ text: str, color: pal.str });
    else if (fn !== undefined) out.push({ text: fn, color: pal.fn });
    else if (kw !== undefined) out.push({ text: kw, color: pal.keyword });
    else if (prop !== undefined) out.push({ text: prop, color: pal.prop });
    else if (hex !== undefined) out.push({ text: hex, color: pal.str });
    else if (literal !== undefined) out.push({ text: literal, color: pal.keyword });
    else if (num !== undefined) out.push({ text: num, color: pal.prop });
    last = re.lastIndex;
  }
  if (last < code.length) out.push({ text: code.slice(last) });
  return out;
}
