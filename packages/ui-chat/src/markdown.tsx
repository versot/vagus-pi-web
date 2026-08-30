import { parseBlocks } from "./parse.js";
import type { MarkdownBlock, InlineNode } from "./parse.js";
import React, { useMemo, useState } from "react";
import { useAppearance, useTheme, useTokens } from "@vagus/ui-tokens";
import { DARK_PALETTE, highlightLine, LIGHT_PALETTE } from "@vagus/ui-shared";
import type { CodePalette, CodeToken } from "@vagus/ui-shared";

/**
 * Lightweight GFM-subset renderer for the GUI (M4a).
 *
 * The GUI is a zero-framework-extras SPA: instead of pulling react-markdown +
 * remark-gfm + highlight.js, this module parses the common block/inline
 * markdown subset itself (headings, code fences, lists, quotes, tables,
 * hr, bold/italic/strike, inline code, links) and renders it with the shared
 * design tokens.
 *
 * Safety: text is never injected as HTML — every node becomes a React element,
 * so `<script>` etc. renders as inert text. Links are restricted to safe
 * schemes (http/https/mailto) to avoid `javascript:` abuse.
 *
 * Streaming safety: an *unclosed* code fence still renders as a growing code
 * block, so streamed deltas never flash a mis-parsed paragraph.
 */

// Markdown rendering — see parse.ts for the pure parsing half.
// ────────────────────────────────── rendering ────────────────────────────────

const CODE_BG = "rgba(79, 140, 255, 0.08)";
const CODE_BORDER = "rgba(79, 140, 255, 0.18)";

/**
 * Memoized line highlighting. Streaming re-parses a growing code block every
 * delta; without caching, `highlightLine` re-runs its regex on EVERY line each
 * time (the whole block, not just the new tail). Cache by theme + line content
 * with a bounded size so long streams stay O(new lines) instead of O(block).
 * `CodeToken[]` is treated as immutable — callers must not mutate it.
 */
const highlightCache = new Map<string, CodeToken[]>();
const HIGHLIGHT_CACHE_MAX = 4000;
function memoHighlight(line: string, pal: CodePalette): CodeToken[] {
  const key = `${line.length}:${line}`;
  const hit = highlightCache.get(key);
  if (hit) return hit;
  const tokens = highlightLine(line, pal);
  if (highlightCache.size >= HIGHLIGHT_CACHE_MAX) {
    // Drop the oldest entry (Map preserves insertion order).
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
  highlightCache.set(key, tokens);
  return tokens;
}

function Inline({ nodes }: { nodes: InlineNode[] }): JSX.Element {
  const t = useTokens();
  return (
    <>
      {nodes.map((node, i) => {
        switch (node.kind) {
          case "text":
            return <React.Fragment key={i}>{node.text}</React.Fragment>;
          case "code":
            return (
              <code
                key={i}
                style={{
                  fontFamily: t.font.mono,
                  fontSize: "0.85em",
                  background: CODE_BG,
                  border: `1px solid ${CODE_BORDER}`,
                  borderRadius: 4,
                  padding: "0.1em 0.35em",
                  color: t.color.accent,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {node.text}
              </code>
            );
          case "bold":
            return <strong key={i} style={{ fontWeight: 700 }}><Inline nodes={node.children} /></strong>;
          case "italic":
            return <em key={i}><Inline nodes={node.children} /></em>;
          case "strike":
            return <s key={i} style={{ opacity: 0.6 }}><Inline nodes={node.children} /></s>;
          case "link":
            return (
              <a
                key={i}
                href={node.href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: t.color.accent, textDecoration: "underline" }}
              >
                <Inline nodes={node.children} />
              </a>
            );
        }
      })}
    </>
  );
}

const BLOCK_MARGIN: React.CSSProperties = { margin: "0 0 10px" };

/**
 * Fenced code block with a header bar (language + one-click copy).
 * Code display follows the *resolved UI theme*: light UI → GitHub Light
 * palette, dark UI → GitHub Dark palette.
 */
function CodeBlock({ text, lang }: { text: string; lang: string }): JSX.Element {
  const { theme } = useTheme();
  const appearance = useAppearance();
  const [copied, setCopied] = useState(false);
  const pal = theme === "light" ? LIGHT_PALETTE : DARK_PALETTE;
  const lines = text.split("\n");

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts: select-and-copy via a temp textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div
      style={{
        margin: BLOCK_MARGIN.margin as string,
        background: pal.bg,
        border: `1px solid ${pal.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 10px 5px 14px",
          borderBottom: `1px solid ${pal.border}`,
          background: "linear-gradient(90deg, rgba(99,102,241,0.08), rgba(99,102,241,0.02))",
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", flexShrink: 0 }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.78em", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", color: pal.text, opacity: 0.75 }}>
            {lang || "code"}
          </span>
        </span>
        <button
          onClick={() => void copy()}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(99,102,241,0.12)"; e.currentTarget.style.borderColor = "rgba(99,102,241,0.45)"; e.currentTarget.style.color = "#6366f1"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.85"; e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = pal.border; e.currentTarget.style.color = copied ? "#16a34a" : pal.text; }}
          style={{
            display: "flex", alignItems: "center", gap: 5,
            background: "transparent", border: `1px solid ${pal.border}`,
            color: copied ? "#16a34a" : pal.text, borderRadius: 6,
            padding: "3px 9px", fontSize: "0.76em", cursor: "pointer",
            opacity: 0.85, transition: "all 0.15s", flexShrink: 0, fontFamily: "inherit",
          }}
        >
          {copied ? (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          )}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre
        style={{
          margin: 0,
          padding: "10px 14px",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: appearance.codeFontSize,
          lineHeight: 1.6,
          overflowX: appearance.wrapLongLines ? "hidden" : "auto",
          color: pal.text,
          whiteSpace: appearance.wrapLongLines ? "pre-wrap" : "pre",
        }}
      >
        {lines.map((ln, i) => (
          <div key={i} style={{ display: "flex", minHeight: "1.6em" }}>
            {appearance.showLineNumbers && (
              <span
                style={{
                  width: 30, flexShrink: 0, textAlign: "right", marginRight: 14,
                  color: pal.text, opacity: 0.35, userSelect: "none", fontVariantNumeric: "tabular-nums",
                }}
              >
                {i + 1}
              </span>
            )}
            <span style={{ whiteSpace: appearance.wrapLongLines ? "pre-wrap" : "pre", minWidth: 0 }}>
              {memoHighlight(ln, pal).map((tok, j) =>
                tok.color !== undefined ? (
                  <span key={j} style={{ color: tok.color }}>{tok.text}</span>
                ) : (
                  <React.Fragment key={j}>{tok.text}</React.Fragment>
                ),
              )}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}

function Block({ block }: { block: MarkdownBlock }): JSX.Element {
  const { tokens: t } = useTheme();
  switch (block.type) {
    case "code":
      return <CodeBlock text={block.text} lang={block.lang} />;
    case "paragraph":
      return (
        <p style={BLOCK_MARGIN}><Inline nodes={block.content} /></p>
      );
    case "heading":
      return (
        <div
          style={{
            margin: "14px 0 8px",
            fontWeight: 700,
            fontSize: block.level === 1 ? 20 : block.level === 2 ? 17 : 15,
            color: t.color.fg,
          }}
        >
          <Inline nodes={block.content} />
        </div>
      );
    case "list":
      return (
        <div style={BLOCK_MARGIN}>
          {block.items.map((item, i) =>
            block.ordered ? (
              <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                <span style={{ color: t.color.muted, minWidth: 22, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {i + 1}.
                </span>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><Inline nodes={item} /></span>
              </div>
            ) : (
              <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0" }}>
                <span style={{ color: t.color.primary, minWidth: 14 }}>•</span>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}><Inline nodes={item} /></span>
              </div>
            ),
          )}
        </div>
      );
    case "quote":
      return (
        <blockquote
          style={{
            margin: BLOCK_MARGIN.margin as string,
            padding: "2px 0 2px 12px",
            borderLeft: `3px solid ${t.color.primary}`,
            color: t.color.muted,
          }}
        >
          <BlockList blocks={block.content} />
        </blockquote>
      );
    case "table":
      return (
        <div style={{ margin: BLOCK_MARGIN.margin as string, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, border: `1px solid ${t.color.border}`, borderRadius: 6 }}>
            <thead>
              <tr>
                {block.headers.map((h, i) => (
                  <th key={i} style={{ border: `1px solid ${t.color.border}`, padding: "6px 10px", background: t.color.surface, fontWeight: 600, textAlign: "left" }}>
                    <Inline nodes={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} style={{ border: `1px solid ${t.color.border}`, padding: "5px 10px" }}>
                      <Inline nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr style={{ border: "none", borderTop: `1px solid ${t.color.border}`, margin: "14px 0" }} />;
  }
}

function BlockList({ blocks }: { blocks: MarkdownBlock[] }): JSX.Element {
  return (
    <>
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </>
  );
}

/** Renders a markdown source string to styled elements. */
export function Markdown({ text }: { text: string }): JSX.Element {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  // Root wrapper: long unbroken strings (URLs, tokens) must wrap instead of
  // overflowing the chat column. `anywhere` allows breaks inside a word/URL
  // even when no natural break point exists.
  return (
    <div style={{ overflowWrap: "anywhere", wordBreak: "break-word", minWidth: 0 }}>
      <BlockList blocks={blocks} />
    </div>
  );
}