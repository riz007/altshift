import type { SourceHint } from "@ariamend/adapters";
import type { Finding, Impact } from "@ariamend/core";
import { describe, expect, it } from "vitest";
import { triage } from "./triage.js";

let next = 0;
function finding(ruleId: string, impact: Impact = "serious", selector = `.el-${next}`): Finding {
  const fingerprint = `fp-${next++}`;
  return {
    fingerprint,
    ruleId,
    impact,
    engine: "axe",
    target: "/",
    checkpoint: "load",
    url: "",
    selector,
    normalizedSelector: selector,
    htmlSnippet: "",
    summary: "",
    helpUrl: "",
    wcag: [],
  };
}
const hint = (file: string): SourceHint[] => [{ file, origin: "vue-component-file", confidence: 0.9 }];

describe("triage", () => {
  it("groups findings of one rule in one component", () => {
    const cards = [finding("button-name"), finding("button-name"), finding("button-name")];
    const hints = new Map(cards.map((item) => [item.fingerprint, hint("app/components/ProductCard.vue")]));

    const { groups } = triage({ findings: cards, hints, maxGroups: 10 });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ ruleId: "button-name", tier: "auto" });
    expect(groups[0]?.findings).toHaveLength(3);
    expect(groups[0]?.hints).toEqual(hint("app/components/ProductCard.vue"));
  });

  it("keeps different rules and different components apart", () => {
    const a = finding("button-name");
    const b = finding("button-name");
    const c = finding("label");
    const hints = new Map([
      [a.fingerprint, hint("app/components/A.vue")],
      [b.fingerprint, hint("app/components/B.vue")],
      [c.fingerprint, hint("app/components/A.vue")],
    ]);

    expect(triage({ findings: [a, b, c], hints, maxGroups: 10 }).groups).toHaveLength(3);
  });

  it("without hints, groups repeated elements by selector with positions removed", () => {
    const first = finding("button-name", "serious", "article:nth-child(1) > .wishlist");
    const second = finding("button-name", "serious", "article:nth-child(2) > .wishlist");
    const elsewhere = finding("button-name", "serious", ".close");

    const { groups } = triage({ findings: [first, second, elsewhere], hints: new Map(), maxGroups: 10 });

    expect(groups.map((group) => group.findings.length).sort()).toEqual([1, 2]);
  });

  it("skips report-tier rules, unknown rules and findings with an open pull request", () => {
    const caption = finding("video-caption");
    const unknown = finding("brand-new-rule");
    const covered = finding("button-name");
    const kept = finding("label");

    const result = triage({
      findings: [caption, unknown, covered, kept],
      hints: new Map(),
      coveredByOpenPr: new Set([covered.fingerprint]),
      maxGroups: 10,
    });

    expect(result.groups.map((group) => group.ruleId)).toEqual(["label"]);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(["open-pr", "report-tier", "report-tier"]);
  });

  it("orders by impact, then by how many findings a fix clears, and applies the limit", () => {
    const minor = finding("list", "minor");
    const critical = finding("label", "critical");
    const seriousPair = [finding("link-name", "serious"), finding("link-name", "serious")];
    const seriousOne = finding("select-name", "serious");
    const hints = new Map(seriousPair.map((item) => [item.fingerprint, hint("app/Nav.vue")]));

    const result = triage({ findings: [minor, seriousOne, ...seriousPair, critical], hints, maxGroups: 3 });

    expect(result.groups.map((group) => group.ruleId)).toEqual(["label", "link-name", "select-name"]);
    expect(result.skipped).toEqual([{ finding: minor, reason: "limit" }]);
  });

  it("honours tier overrides and keeps suggest-tier groups", () => {
    const contrast = finding("color-contrast");
    const button = finding("button-name");

    const result = triage({
      findings: [contrast, button],
      hints: new Map(),
      ruleTiers: { "button-name": "report" },
      maxGroups: 10,
    });

    expect(result.groups.map((group) => group.tier)).toEqual(["suggest"]);
  });

  it("gives the same groups and ids whatever the input order", () => {
    const items = [finding("label"), finding("button-name"), finding("link-name")];
    const run = (list: Finding[]) =>
      triage({ findings: list, hints: new Map(), maxGroups: 10 }).groups.map((group) => group.id);

    expect(run([...items].reverse())).toEqual(run(items));
  });
});
