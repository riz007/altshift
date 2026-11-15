import { describe, expect, it } from "vitest";
import { escapeUntrusted, inlineCode } from "./markdown.js";

describe("escapeUntrusted", () => {
  it("breaks mentions so page text cannot ping people", () => {
    expect(escapeUntrusted("ask @octocat")).not.toMatch(/@octocat/);
  });

  it("removes HTML comments, including unclosed ones", () => {
    expect(escapeUntrusted("a<!-- hidden -->b<!-- open")).toBe("ab");
  });

  it("escapes link syntax", () => {
    expect(escapeUntrusted("[click](https://evil.example)")).not.toContain("](");
  });
});

describe("escapeUntrusted entities", () => {
  it("escapes ampersands so entities cannot become mentions or tags", () => {
    expect(escapeUntrusted("&#64;octocat &lt;img&gt;")).toBe("&amp;\\#64;octocat &amp;lt;img&amp;gt;");
  });
});

describe("inlineCode", () => {
  it("escapes pipes only inside table cells", () => {
    expect(inlineCode("a|b")).toBe("` a|b `");
    expect(inlineCode("a|b", 200, true)).toBe("` a\\|b `");
  });

  it("uses a longer fence than any backtick run inside", () => {
    expect(inlineCode("a ``b`` c")).toBe("``` a ``b`` c ```");
  });
});
