import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff.js";

describe("lineDiff", () => {
  it("reports nothing for identical text", () => {
    expect(lineDiff("a\nb\nc", "a\nb\nc")).toEqual({ added: [], removed: [] });
  });

  it("reports a changed line as one removal and one addition", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc")).toEqual({ added: ["B"], removed: ["b"] });
  });

  it("handles insertions and deletions away from the edges", () => {
    expect(lineDiff("a\nb\nc\nd", "a\nc\nx\ny\nd")).toEqual({ added: ["x", "y"], removed: ["b"] });
  });

  it("does not count a moved block as unchanged twice", () => {
    const diff = lineDiff("one\ntwo\nthree", "three\none\ntwo");
    expect(diff.added.length + diff.removed.length).toBe(2);
  });

  it("handles empty sides", () => {
    expect(lineDiff("", "a\nb")).toEqual({ added: ["a", "b"], removed: [""] });
  });
});
