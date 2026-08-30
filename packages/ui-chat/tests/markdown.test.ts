import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "@vagus/ui-chat";
import type { InlineNode } from "@vagus/ui-chat";

/**
 * The GUI's zero-dependency markdown renderer. These tests pin the parse
 * contract (blocks + inline) that feeds the styled React output — most
 * importantly the *streaming-safe* unclosed-fence behavior and link safety.
 */

describe("parseBlocks", () => {
  it("parses headings with levels", () => {
    const blocks = parseBlocks("# Title\n\n## Sub");
    expect(blocks.map((b) => b.type)).toEqual(["heading", "heading"]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 1 });
    expect(blocks[1]).toMatchObject({ type: "heading", level: 2 });
  });

  it("parses a code fence with language", () => {
    const blocks = parseBlocks("```ts\nconst x = 1;\n```");
    expect(blocks).toEqual([{ type: "code", lang: "ts", text: "const x = 1;" }]);
  });

  it("keeps an unclosed fence as a code block (streaming safety)", () => {
    // While the model streams, the closing ``` hasn't arrived yet. The block
    // must render as a growing code block, not a mis-parsed paragraph.
    const blocks = parseBlocks("```ts\nconst x = 1;");
    expect(blocks).toEqual([{ type: "code", lang: "ts", text: "const x = 1;" }]);
  });

  it("parses ordered and unordered lists", () => {
    const blocks = parseBlocks("- a\n- b\n\n1. one\n2. two");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    if (blocks[0]?.type !== "list") return expect(blocks[0]).toBeDefined();
    expect(blocks[0].items).toHaveLength(2);

    expect(blocks[1]).toMatchObject({ type: "list", ordered: true });
  });

  it("parses blockquotes with nested blocks", () => {
    const blocks = parseBlocks("> note\n> **bold** inside");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.type).toBe("quote");
    if (blocks[0]?.type !== "quote") return expect(blocks[0]).toBeDefined();
    // The nested content should contain a paragraph with a bold node.
    const nested = blocks[0].content[0];
    expect(nested?.type).toBe("paragraph");
  });

  it("parses GFM tables", () => {
    const blocks = parseBlocks("| a | b |\n|---|---|\n| 1 | 2 |");
    expect(blocks).toHaveLength(1);
    const table = blocks[0];
    if (!table || table.type !== "table") return expect(table).toBeDefined();
    expect(table.headers.length).toBe(2);
    expect(table.rows).toHaveLength(1);
  });

  it("treats a lone pipe row as a paragraph (not a table)", () => {
    const blocks = parseBlocks("just | a | line");
    expect(blocks[0]?.type).toBe("paragraph");
  });

  it("parses horizontal rules", () => {
    expect(parseBlocks("---")[0]?.type).toBe("hr");
    expect(parseBlocks("***")[0]?.type).toBe("hr");
  });
});

describe("parseInline", () => {
  it("parses bold, italic, code, strike and links", () => {
    const nodes = parseInline("**b** *i* `c` ~~s~~ [link](https://x.dev)");
    expect(nodes.map((n) => n.kind)).toEqual(["bold", "text", "italic", "text", "code", "text", "strike", "text", "link"]);
  });

  it("supports nesting (bold containing italic)", () => {
    const nodes = parseInline("**bold *and italic***");
    expect(nodes[0]?.kind).toBe("bold");
    if (nodes[0]?.kind !== "bold") return;
    expect(nodes[0].children.some((n) => n.kind === "italic")).toBe(true);
  });

  it("keeps inline code atomic (backticks never leak into emphasis)", () => {
    const nodes = parseInline("`**not bold**`");
    expect(nodes).toEqual([{ kind: "code", text: "**not bold**" }]);
  });

  it("drops javascript: links (renders as inert text)", () => {
    const nodes = parseInline("[bad](javascript:alert(1))");
    expect(nodes.every((n) => n.kind !== "link")).toBe(true);
    const text = nodes.map((n) => (n.kind === "text" ? n.text : "")).join("");
    expect(text).toBe("[bad](javascript:alert(1))");
  });

  it("allows http/https/mailto links", () => {
    const nodes = parseInline("[pi](https://pi.dev) [m](mailto:a@b.c)");
    const links = nodes.filter((n): n is Extract<InlineNode, { kind: "link" }> => n.kind === "link");
    expect(links.map((l) => l.href)).toEqual(["https://pi.dev", "mailto:a@b.c"]);
  });

  it("escapes nothing dangerous — raw HTML stays inert text", () => {
    const nodes = parseInline("<script>alert(1)</script>");
    expect(nodes).toEqual([{ kind: "text", text: "<script>alert(1)</script>" }]);
  });
});
