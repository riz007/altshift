import { type Browser, chromium } from "playwright";
import type { ResolvedConfig } from "./config.js";
import { startDevServer } from "./dev-server.js";
import { axeEngine } from "./engines/axe.js";
import { loadConfig, loadJourneys } from "./load.js";
import { errorMessage, fail, ok, type Result } from "./result.js";
import { scanTargets } from "./scan.js";
import type { ScanReport } from "./types.js";

export interface RunScanOptions {
  cwd: string;
  configPath?: string;
  /** Progress lines for a person. Never part of the report. */
  log?: (line: string) => void;
}

export interface ScanRun {
  report: ScanReport;
  config: ResolvedConfig;
}

/** Load config, bring up the dev server, scan every target, and shut everything down again. */
export async function runScan(options: RunScanOptions): Promise<Result<ScanRun>> {
  const log = options.log ?? (() => {});

  const loaded = await loadConfig(options.cwd, options.configPath);
  if (!loaded.ok) return loaded;
  const { config, root } = loaded.value;

  if (config.app.dev === undefined) {
    return fail("config-invalid", "app.dev is required: AltShift scans a dev build that it starts itself.");
  }
  if (config.scan.engine !== "axe") {
    return fail("engine-unavailable", `The "${config.scan.engine}" engine is not available yet. Use "axe".`);
  }

  const journeys = await loadJourneys(root, config.targets.journeys);
  if (!journeys.ok) return journeys;
  if (config.targets.pages.length === 0 && journeys.value.length === 0) {
    return fail("nothing-to-scan", "No page targets and no journeys. Add targets.pages or targets.journeys.");
  }

  log(`Starting dev server: ${config.app.dev.command}`);
  const server = await startDevServer({ ...config.app.dev, cwd: root });
  if (!server.ok) return server;
  if (server.value.reused) log(`Using the server already running at ${config.app.dev.url}`);

  let browser: Browser | undefined;
  try {
    try {
      browser = await chromium.launch();
    } catch (error) {
      return fail(
        "browser",
        `Could not start Chromium: ${errorMessage(error).split("\n")[0]}\nRun "npx playwright install chromium" and try again.`,
      );
    }

    log(`Scanning ${config.targets.pages.length} page(s) and ${journeys.value.length} journey(s)`);
    const report = await scanTargets({
      browser,
      baseUrl: config.app.dev.url,
      pages: config.targets.pages,
      journeys: journeys.value,
      engine: axeEngine,
      tags: config.scan.tags,
      exclude: config.targets.exclude,
    });
    return ok({ report, config });
  } finally {
    await browser?.close();
    await server.value.stop();
  }
}
