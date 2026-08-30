/**
 * Markdown parsing — pure functions (no React, no tokens). Split from the
 * renderer so it can be unit-tested in isolation.
 *
 * Safety: text is never injected as HTML — every node becomes a React element,
 * so `<script>` etc. renders as inert text. Links are restricted to safe
 * schemes (http/https/mailto) to avoid `javascript:` abuse.
 */
// ───────────────────────────────── block parsing ─────────────────────────────

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: InlineNode[] }
  | { kind: "italic"; children: InlineNode[] }
  | { kind: "strike"; children: InlineNode[] }
  | { kind: "link"; href: string; children: InlineNode[] };

export type MarkdownBlock =
  | { type: "paragraph"; content: InlineNode[] }
  | { type: "code"; lang: string; text: string }
  | { type: "heading"; level: number; content: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "quote"; content: MarkdownBlock[] }
  | { type: "table"; headers: InlineNode[][]; rows: InlineNode[][][] }
  | { type: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FENCE_RE = /^```(\w*)\s*$/;
const HR_RE = /^\s*(---+|\*\*\*+|___+)\s*$/;
const QUOTE_RE = /^\s*>\s?(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const TABLE_ROW_RE = /^\s*\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^[\s:|:-]+$/;

/** Splits raw markdown into blocks (fence-aware, streaming-safe). */
export function parseBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    // Code fence: opening ```lang … closing ``` (unclosed → block to EOF).
    const fence = line.match(FENCE_RE);
    if (fence) {
      const lang = fence[1] ?? "";
      const buf: string[] = [];
      i += 1;
      let closed = false;
      while (i < lines.length) {
        if (FENCE_RE.test(lines[i] ?? "")) {
          closed = true;
          i += 1;
          break;
        }
        buf.push(lines[i] ?? "");
        i += 1;
      }
      void closed;
      blocks.push({ type: "code", lang, text: buf.join("\n") });
      continue;
    }

    // Heading.
    const heading = line.match(HEADING_RE);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, content: parseInline(heading[2] ?? "") });
      i += 1;
      continue;
    }

    // Horizontal rule.
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i += 1;
      continue;
    }

    // Blockquote: collect consecutive `>` lines, recurse for nested blocks.
    if (QUOTE_RE.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i] ?? "")) {
        buf.push((lines[i] ?? "").replace(QUOTE_RE, "$1"));
        i += 1;
      }
      blocks.push({ type: "quote", content: parseBlocks(buf.join("\n")) });
      continue;
    }

    // List: collect consecutive items (same kind), stripping one indent level.
    const list = line.match(LIST_RE);
    if (list) {
      const ordered = /\d+\./.test(list[2] ?? "");
      const items: InlineNode[][] = [];
      const indent = (list[1] ?? "").length;
      while (i < lines.length) {
        const maybe = lines[i]?.match(LIST_RE);
        const itemIndent = (maybe?.[1] ?? "").length;
        const isOrdered = maybe !== undefined && maybe !== null && /\d+\./.test(maybe[2] ?? "");
        if (!maybe || itemIndent !== indent || isOrdered !== ordered) break;
        const rest = (maybe[3] ?? "").trim();
        // Loose continuation lines inside an item (indented, not a new item).
        const itemLines = [rest];
        while (i + 1 < lines.length) {
          const next = lines[i + 1] ?? "";
          if (next.length > 0 && !/^\s*$/.test(next) && !LIST_RE.test(next) && !QUOTE_RE.test(next) && !FENCE_RE.test(next)) {
            itemLines.push(next.replace(/^\s+/, ""));
            i += 1;
          } else break;
        }
        items.push(parseInline(itemLines.join(" ")));
        i += 1;
      }
      blocks.push({ type: "list", ordered, items });
      continue;
    }

    // Table: header row + separator row + data rows.
    if (TABLE_ROW_RE.test(line)) {
      const headerCells = splitTableRow(line);
      const sep = lines[i + 1] ?? "";
      if (headerCells.length > 1 && TABLE_SEP_RE.test(sep) && sep.includes("-")) {
        const headers = headerCells.map((cell) => parseInline(cell));
        const rows: InlineNode[][][] = [];
        i += 2;
        while (i < lines.length && TABLE_ROW_RE.test(lines[i] ?? "")) {
          rows.push(splitTableRow(lines[i] ?? "").map((cell) => parseInline(cell)));
          i += 1;
        }
        blocks.push({ type: "table", headers, rows });
        continue;
      }
      // Not a real table → fall through to paragraph.
    }

    // Blank line: skip.
    if (/^\s*$/.test(line)) {
      i += 1;
      continue;
    }

    // Paragraph: collect until a blank line or a new block start.
    const buf = [line.trim()];
    i += 1;
    while (i < lines.length) {
      const next = lines[i] ?? "";
      if (
        /^\s*$/.test(next) ||
        HEADING_RE.test(next) ||
        FENCE_RE.test(next) ||
        HR_RE.test(next) ||
        QUOTE_RE.test(next) ||
        LIST_RE.test(next) ||
        (TABLE_ROW_RE.test(next) && (lines[i + 1] ?? "").includes("-") && TABLE_SEP_RE.test(lines[i + 1] ?? ""))
      ) {
        break;
      }
      buf.push(next.trim());
      i += 1;
    }
    blocks.push({ type: "paragraph", content: parseInline(buf.join(" ")) });
  }

  return blocks;
}

function splitTableRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((cell) => cell.trim());
}

// ──────────────────────────────── inline parsing ─────────────────────────────

const SAFE_URL_RE = /^(https?|mailto):/i;

/**
 * Parses inline styling into a tree. A single alternating regex drives the
 * scan (code first so backticks never leak into emphasis), and emphasis
 * content is parsed recursively so `**bold *nested* bold**` works.
 */
export function parseInline(source: string): InlineNode[] {
  const INLINE_RE =
    /(`[^`\n]+`)|(\*\*(?=\S).+?\*\*(?!\*))|(__[^_\n]+__)|(\*(?=\S)[^*\n]+?\*)|(_[^_\n\s][^_\n]*_)|(~~[^~\n]+~~)|(\[[^\]\n]+\]\([^)\n\s]+\))/g;

  const nodes: InlineNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = INLINE_RE.exec(source)) !== null) {
    if (match.index > last) nodes.push({ kind: "text", text: source.slice(last, match.index) });
    last = INLINE_RE.lastIndex;

    const [full, code, bold, boldU, italic, italicU, strike, link] = match as RegExpExecArray & string[];
    if (code !== undefined) {
      nodes.push({ kind: "code", text: code.slice(1, -1) });
    } else if (bold !== undefined) {
      nodes.push({ kind: "bold", children: parseInline(bold.slice(2, -2)) });
    } else if (boldU !== undefined) {
      nodes.push({ kind: "bold", children: parseInline(boldU.slice(2, -2)) });
    } else if (italic !== undefined) {
      nodes.push({ kind: "italic", children: parseInline(italic.slice(1, -1)) });
    } else if (italicU !== undefined) {
      nodes.push({ kind: "italic", children: parseInline(italicU.slice(1, -1)) });
    } else if (strike !== undefined) {
      nodes.push({ kind: "strike", children: parseInline(strike.slice(2, -2)) });
    } else if (link !== undefined) {
      const m = link.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      if (m) {
        const href = m[2] ?? "";
        nodes.push(
          SAFE_URL_RE.test(href)
            ? { kind: "link", href, children: parseInline(m[1] ?? "") }
            : { kind: "text", text: full },
        );
      } else {
        nodes.push({ kind: "text", text: full });
      }
    }
  }
  if (last < source.length) nodes.push({ kind: "text", text: source.slice(last) });
  return nodes;
}
