import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runScan, type ScanReport } from "altshift";
import { beforeAll, describe, expect, it } from "vitest";

interface Seed {
  target: string;
  checkpoint: string;
  ruleId: string;
  count: number;
  file: string;
}

const root = resolve(import.meta.dirname, "..");
const key = (item: { target: string; checkpoint: string; ruleId: string }) =>
  `${item.target} | ${item.checkpoint} | ${item.ruleId}`;

let seeds: Seed[];
let report: ScanReport;

beforeAll(async () => {
  seeds = JSON.parse(await readFile(resolve(root, "seeds.json"), "utf8"));
  const result = await runScan({ cwd: root });
  if (!result.ok) throw new Error(result.error.message);
  report = result.value.report;
});

describe("nuxt fixture scan", () => {
  it("scans every target without failures", () => {
    expect(report.failures).toEqual([]);
    expect(report.scanned.map((item) => `${item.target} | ${item.checkpoint}`)).toEqual([
      "/ | load",
      "/products/trail-mug | load",
      "/shipping | load",
      "cart-open | drawer",
      "checkout-errors | errors",
    ]);
  });

  it("finds every seeded violation, and only those", () => {
    const found: Record<string, number> = {};
    for (const finding of report.findings) found[key(finding)] = (found[key(finding)] ?? 0) + 1;

    expect(found).toEqual(Object.fromEntries(seeds.map((seed) => [key(seed), seed.count])));
  });

  it("reports nothing on the clean page", () => {
    expect(report.findings.filter((finding) => finding.target === "/shipping")).toEqual([]);
  });

  it("gives every finding its own fingerprint", () => {
    const fingerprints = report.findings.map((finding) => finding.fingerprint);
    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });

  it("keeps Vue scope attributes out of normalized selectors", () => {
    expect(report.findings.filter((finding) => /data-v-/.test(finding.normalizedSelector))).toEqual([]);
  });

  it("has a seed comment in the source for every entry in seeds.json", async () => {
    for (const seed of seeds) {
      const source = await readFile(resolve(root, seed.file), "utf8");
      expect(source, `${seed.file} is missing its ${seed.ruleId} seed comment`).toContain(
        `altshift-seed: ${seed.ruleId} `,
      );
    }
  });
});
