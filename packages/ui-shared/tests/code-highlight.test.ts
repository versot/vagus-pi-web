import { describe, expect, it } from "vitest";
import { highlightLine } from "../src/code-highlight.js";

// Tokens must tile the input exactly — a token match that is consumed by the
// regex but never emitted silently deletes code text (regression: numbers,
// hex colors and literals had no capture group and vanished).
describe("highlightLine", () => {
  const pal = { bg: "", header: "", border: "", text: "", keyword: "k", fn: "f", type: "t", prop: "p", str: "s" };

  it.each([
    "for i in range(10):",
    "print(i * 2)  # 0, 2, 4 ... 18",
    "const rate = 0.075;",
    "console.log(1000 * (1 + rate) ** 5); // ≈ 1440.10",
    'color = "#ff0000"; flag = true; x = null;',
    '"string intact" + x',
  ])("preserves every character of %j", (line) => {
    const joined = highlightLine(line, pal)
      .map((t) => t.text)
      .join("");
    expect(joined).toBe(line);
  });

  it("colors numbers, hex and literals", () => {
    const toks = highlightLine('x = 10; c = #fff; z = true;', pal);
    const num = toks.find((t) => t.text === "10");
    const hex = toks.find((t) => t.text === "#fff");
    const lit = toks.find((t) => t.text === "true");
    expect(num?.color).toBe("p");
    expect(hex?.color).toBe("s");
    expect(lit?.color).toBe("k");
  });
});
