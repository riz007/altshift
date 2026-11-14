import type { Browser, Page } from "playwright";
import type { EngineScanOptions, RawFinding, ScanEngine } from "./engines/types.js";
import { FINGERPRINT_VERSION, fingerprint } from "./fingerprint.js";
import type { Journey } from "./journey.js";
import { normalizeSelector } from "./normalize.js";
import { errorMessage } from "./result.js";
import {
  type EngineId,
  type Finding,
  PAGE_CHECKPOINT,
  type ScanFailure,
  type ScannedCheckpoint,
  type ScanReport,
} from "./types.js";

export interface ScanInput {
  browser: Browser;
  /** Origin of the dev server. Page paths and journey navigation resolve against it. */
  baseUrl: string;
  pages: string[];
  journeys: Journey[];
  engine: ScanEngine;
  tags: string[];
  exclude: string[];
}

const SETTLE_TIMEOUT_MS = 5000;

export function toFinding(
  raw: RawFinding,
  where: { engine: EngineId; target: string; checkpoint: string; url: string },
): Finding {
  const normalizedSelector = normalizeSelector(raw.selector);
  return {
    fingerprint: fingerprint({
      engine: where.engine,
      ruleId: raw.ruleId,
      target: where.target,
      checkpoint: where.checkpoint,
      normalizedSelector,
    }),
    engine: where.engine,
    ruleId: raw.ruleId,
    impact: raw.impact,
    target: where.target,
    checkpoint: where.checkpoint,
    url: where.url,
    selector: raw.selector,
    normalizedSelector,
    htmlSnippet: raw.htmlSnippet,
    summary: raw.summary,
    helpUrl: raw.helpUrl,
    wcag: raw.wcag,
  };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      compare(a.target, b.target) ||
      compare(a.checkpoint, b.checkpoint) ||
      compare(a.ruleId, b.ruleId) ||
      compare(a.normalizedSelector, b.normalizedSelector) ||
      compare(a.selector, b.selector),
  );
}

// Playwright errors carry a call log after the first line. Keep the part a person can act on.
function firstLine(error: unknown): string {
  return (errorMessage(error).split("\n")[0] ?? "").slice(0, 300);
}

export async function scanTargets(input: ScanInput): Promise<ScanReport> {
  const findings: Finding[] = [];
  const scanned: ScannedCheckpoint[] = [];
  const failures: ScanFailure[] = [];
  let engineVersion = "unknown";

  const runCheck = async (page: Page, target: string, checkpoint: string, options: Partial<EngineScanOptions>) => {
    const result = await input.engine.scan(page, {
      tags: input.tags,
      exclude: [...input.exclude, ...(options.exclude ?? [])],
      include: options.include ?? [],
    });
    engineVersion = result.engineVersion;
    const where = { engine: input.engine.id, target, checkpoint, url: page.url() };
    scanned.push({ target, checkpoint, url: where.url });
    for (const raw of result.findings) findings.push(toFinding(raw, where));
  };

  // A fresh context per target, so cookies and storage from one never leak into the next.
  const withPage = async (target: string, run: (page: Page) => Promise<void>) => {
    const context = await input.browser.newContext({ baseURL: input.baseUrl });
    try {
      await run(await context.newPage());
    } catch (error) {
      failures.push({ target, message: firstLine(error) });
    } finally {
      await context.close();
    }
  };

  for (const path of [...new Set(input.pages)].sort()) {
    await withPage(path, async (page) => {
      const response = await page.goto(path, { waitUntil: "load" });
      // Scanning an error page would report findings that belong to no real state.
      if (response === null || response.status() >= 400) {
        throw new Error(`${path} returned HTTP ${response?.status() ?? "no response"}`);
      }
      await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
      await runCheck(page, path, PAGE_CHECKPOINT, {});
    });
  }

  for (const journey of [...input.journeys].sort((a, b) => compare(a.name, b.name))) {
    await withPage(journey.name, async (page) => {
      const used = new Set<string>();
      await journey.run({
        page,
        check: async (name, options) => {
          if (used.has(name)) throw new Error(`Checkpoint "${name}" is used twice in journey "${journey.name}"`);
          used.add(name);
          await runCheck(page, journey.name, name, options ?? {});
        },
      });
      if (used.size === 0) throw new Error(`Journey "${journey.name}" never called check()`);
    });
  }

  return {
    schemaVersion: 1,
    fingerprintVersion: FINGERPRINT_VERSION,
    engine: { id: input.engine.id, version: engineVersion },
    scanned: scanned.sort((a, b) => compare(a.target, b.target) || compare(a.checkpoint, b.checkpoint)),
    findings: sortFindings(findings),
    failures: failures.sort((a, b) => compare(a.target, b.target)),
  };
}
