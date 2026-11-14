import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  pixelDiffRatio,
  type RescanInput,
  rescanGate,
  safetyGate,
  scopeGate,
  visualGate,
  Workspace,
} from "@altshift/fix";
import {
  axeEngine,
  type DevServer,
  type Journey,
  loadConfig,
  loadJourneys,
  type ResolvedConfig,
  scanTargets,
  startDevServer,
} from "altshift";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Gates against a real dev server: a hand-written fix goes to disk, the server reloads, and the page is scanned again.

const root = resolve(import.meta.dirname, "..");
const FILE = "app/components/CartDrawer.vue";
const CLOSE = '<button type="button" class="icon-button cart-drawer__close" @click="open = false">';
const edit = (newString: string) => [{ path: FILE, oldString: CLOSE, newString, rationale: "test" }];
const policy = { root, allowPaths: ["app/**"], denyPaths: [] };

let config: ResolvedConfig;
let journey: Journey;
let server: DevServer;
let browser: Browser;
let workspace: Workspace;
let original: string;

interface Snapshot extends RescanInput {
  screenshot: Buffer;
}

async function scanDrawer(): Promise<Snapshot> {
  let screenshot: Buffer | undefined;
  const report = await scanTargets({
    browser,
    baseUrl: config.app.dev?.url ?? "",
    pages: [],
    journeys: [journey],
    engine: axeEngine,
    tags: config.scan.tags,
    exclude: [],
    onCheckpoint: async ({ page }) => {
      screenshot = await page.screenshot({ animations: "disabled", caret: "hide" });
    },
  });
  if (report.failures.length > 0 || !screenshot) throw new Error(JSON.stringify(report.failures));
  return { findings: report.findings, scanned: report.scanned, failures: report.failures, screenshot };
}

// Vite needs a moment to notice the file change before a fresh page load serves it.
async function afterReload(): Promise<Snapshot> {
  await sleep(1500);
  return scanDrawer();
}

beforeAll(async () => {
  original = await readFile(resolve(root, FILE), "utf8");
  const loaded = await loadConfig(root);
  if (!loaded.ok) throw new Error(loaded.error.message);
  config = loaded.value.config;
  if (!config.app.dev) throw new Error("fixture config has no app.dev");

  const journeys = await loadJourneys(root, config.targets.journeys);
  const found = journeys.ok ? journeys.value.find((item) => item.name === "cart-open") : undefined;
  if (!found) throw new Error("cart-open journey not found");
  journey = found;

  const started = await startDevServer({ ...config.app.dev, cwd: root });
  if (!started.ok) throw new Error(started.error.message);
  server = started.value;
  browser = await chromium.launch();
  workspace = new Workspace(policy);
});

afterAll(async () => {
  await workspace?.restore();
  await browser?.close();
  await server?.stop();
  expect(await readFile(resolve(root, FILE), "utf8")).toBe(original);
});

describe("gates on the nuxt fixture", () => {
  it("passes a correct fix through scope, safety, rescan and visual", async () => {
    const before = await scanDrawer();
    const group = before.findings.filter((finding) => finding.ruleId === "button-name");
    expect(group).toHaveLength(1);

    const fixed = CLOSE.replace("@click", 'aria-label="Close cart" @click');
    const changes = [{ path: FILE, before: original, after: original.replace(CLOSE, fixed) }];
    expect(scopeGate(changes, policy).passed).toBe(true);
    expect(safetyGate(changes)).toMatchObject({ passed: true, flagged: true });

    expect(await workspace.apply("label", edit(fixed))).toBe(true);
    const after = await afterReload();

    expect(rescanGate(group, before, after)).toMatchObject({ passed: true });
    const page = await browser.newPage();
    const ratio = await pixelDiffRatio(page, before.screenshot, after.screenshot);
    await page.close();
    expect(visualGate(ratio, config.fix.visualDiffThreshold, "button-name")).toMatchObject({ passed: true });

    await workspace.revert("label");
    const reverted = await afterReload();
    expect(reverted.findings.map((finding) => finding.fingerprint)).toEqual(
      before.findings.map((finding) => finding.fingerprint),
    );
  });

  it("fails rescan when a fix clears the finding but adds another", async () => {
    const before = await scanDrawer();
    const group = before.findings.filter((finding) => finding.ruleId === "button-name");

    const traded = CLOSE.replace("@click", 'aria-label="Close cart" role="checkbox" @click');
    expect(await workspace.apply("traded", edit(traded))).toBe(true);
    const after = await afterReload();
    await workspace.revert("traded");

    const result = rescanGate(group, before, after);
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("aria-required-attr");
  });

  it("measures a real visual difference", async () => {
    const drawer = await scanDrawer();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto(`${config.app.dev?.url}/shipping`);
    const other = await page.screenshot();

    expect(await pixelDiffRatio(page, drawer.screenshot, drawer.screenshot)).toBe(0);
    expect(await pixelDiffRatio(page, drawer.screenshot, other)).toBeGreaterThan(0.02);
    await page.close();
  });
});
