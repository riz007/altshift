import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nuxtAdapter, type SourceHint } from "@altshift/adapters";
import {
  axeEngine,
  type Finding,
  loadConfig,
  loadJourneys,
  type ScanReport,
  scanTargets,
  startDevServer,
} from "altshift";
import { chromium } from "playwright";
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
const hints = new Map<string, SourceHint[]>();

// Same steps as runScan, plus the checkpoint hook the fix engine uses to collect source hints.
beforeAll(async () => {
  seeds = JSON.parse(await readFile(resolve(root, "seeds.json"), "utf8"));

  const loaded = await loadConfig(root);
  if (!loaded.ok) throw new Error(loaded.error.message);
  const { config } = loaded.value;
  if (!config.app.dev) throw new Error("fixture config has no app.dev");
  const journeys = await loadJourneys(root, config.targets.journeys);
  if (!journeys.ok) throw new Error(journeys.error.message);
  const server = await startDevServer({ ...config.app.dev, cwd: root });
  if (!server.ok) throw new Error(server.error.message);

  const browser = await chromium.launch();
  try {
    report = await scanTargets({
      browser,
      baseUrl: config.app.dev.url,
      pages: config.targets.pages,
      journeys: journeys.value,
      engine: axeEngine,
      tags: config.scan.tags,
      exclude: config.targets.exclude,
      onCheckpoint: async ({ page, findings }) => {
        for (const finding of findings) {
          hints.set(finding.fingerprint, await nuxtAdapter.collectSourceHints(page, finding.selector, root));
        }
      },
    });
  } finally {
    await browser.close();
    await server.value.stop();
  }
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

  it("points every finding at the component that holds its seed", () => {
    const seedFile = (finding: Finding) => seeds.find((seed) => key(seed) === key(finding))?.file;
    const wrong = report.findings
      .map((finding) => ({
        rule: key(finding),
        expected: seedFile(finding),
        got: hints.get(finding.fingerprint)?.[0]?.file,
      }))
      .filter((item) => item.expected !== item.got);

    expect(wrong).toEqual([]);
  });
});
