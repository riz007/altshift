import {
  adapterFor,
  detectAdapter,
  type FrameworkAdapter,
  type SourceHint,
} from "@altshift/adapters";
import {
  axeEngine,
  type DevServer,
  errorMessage,
  fail,
  type Finding,
  type Journey,
  loadConfig,
  loadJourneys,
  ok,
  type ResolvedConfig,
  type Result,
  runCommand,
  scanTargets,
  startDevServer,
} from "altshift";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { type Browser, chromium } from "playwright";
import { Agent, type AgentStop, type ModelClient } from "./agent.js";
import {
  buildGate,
  checksGate,
  rescanGate,
  type RescanInput,
  safetyGate,
  scopeGate,
  visualGate,
} from "./gates/index.js";
import { pixelDiffRatio } from "./gates/visual.js";
import { resolveModels } from "./models.js";
import type { PathPolicy } from "./paths.js";
import { requirePrice, UnknownPriceError } from "./pricing.js";
import { gateFeedback, groupMessage, loadFixPrompt } from "./prompt.js";
import { EditSession } from "./session.js";
import {
  collectCssVariables,
  type DesignTokens,
} from "./tools/design-tokens.js";
import { listAllowedFiles } from "./tools/files.js";
import type { FindingContext, ToolContext } from "./tools/index.js";
import { triage } from "./triage.js";
import type {
  Attempt,
  FindingGroup,
  FixOutcome,
  FixRunReport,
  GateResult,
} from "./types.js";
import { Workspace } from "./workspace.js";

export interface RunFixOptions {
  cwd: string;
  configPath?: string;
  /** Only dry runs exist so far: fixes are gated, reported, then taken back out. */
  dryRun: true;
  client: ModelClient;
  /** Restrict the run to the group that contains this fingerprint. */
  onlyFinding?: string;
  log?: (line: string) => void;
}

const GROUP_BUDGET_SHARE = 0.25;

// Vite needs a moment to notice a changed file before a fresh page load serves it.
const RELOAD_WAIT_MS = 1500;

interface Snapshot extends RescanInput {
  /** PNG per "target | checkpoint". */
  screenshots: Map<string, Buffer>;
  hints: Map<string, SourceHint[]>;
}

interface Run {
  config: ResolvedConfig;
  root: string;
  adapter: FrameworkAdapter;
  journeys: Journey[];
  browser: Browser;
  policy: PathPolicy;
  workspace: Workspace;
  tokens: DesignTokens;
  system: string;
  models: ReturnType<typeof resolveModels>;
  client: ModelClient;
  log: (line: string) => void;
  spentUsd: number;
}

async function snapshot(run: Run): Promise<Snapshot> {
  const screenshots = new Map<string, Buffer>();
  const hints = new Map<string, SourceHint[]>();
  const report = await scanTargets({
    browser: run.browser,
    baseUrl: run.config.app.dev?.url ?? "",
    pages: run.config.targets.pages,
    journeys: run.journeys,
    engine: axeEngine,
    tags: run.config.scan.tags,
    exclude: run.config.targets.exclude,
    onCheckpoint: async ({ page, target, checkpoint, findings }) => {
      screenshots.set(
        `${target} | ${checkpoint}`,
        await page.screenshot({ animations: "disabled", caret: "hide" }),
      );
      for (const finding of findings) {
        hints.set(
          finding.fingerprint,
          await run.adapter.collectSourceHints(
            page,
            finding.selector,
            run.root,
          ),
        );
      }
    },
  });
  return {
    findings: report.findings,
    scanned: report.scanned,
    failures: report.failures,
    screenshots,
    hints,
  };
}

async function worstPixelRatio(
  run: Run,
  before: Snapshot,
  after: Snapshot,
): Promise<number> {
  const page = await run.browser.newPage();
  try {
    let worst = 0;
    for (const [key, image] of before.screenshots) {
      const other = after.screenshots.get(key);
      worst = Math.max(
        worst,
        other ? await pixelDiffRatio(page, image, other) : 1,
      );
    }
    return worst;
  } finally {
    await page.close();
  }
}

function toolContext(
  run: Run,
  group: FindingGroup,
  baseline: Snapshot,
): ToolContext {
  const findings = new Map<string, FindingContext>(
    group.findings.map((finding) => [
      finding.fingerprint,
      { finding, hints: baseline.hints.get(finding.fingerprint) ?? [] },
    ]),
  );
  return {
    session: new EditSession(run.policy),
    findings,
    designTokens: run.tokens,
  };
}

function attemptFrom(
  model: string,
  stop: AgentStop,
  context: ToolContext,
  costUsd: number,
): Attempt {
  return {
    model,
    edits: [...context.session.edits],
    gates: [],
    costUsd,
    stopReason: stop.reason,
    summary: stop.reason === "finish" ? stop.end.summary : stop.message,
  };
}

/** Apply the staged edits and run every per-group gate in order. Reverts the edits on the first failure. */
async function gate(
  run: Run,
  group: FindingGroup,
  context: ToolContext,
  baseline: Snapshot,
): Promise<{ results: GateResult[]; after?: Snapshot }> {
  const results: GateResult[] = [];
  const failed = () => results.at(-1)?.passed === false;
  let kept = false;
  const changes = context.session.changes();

  results.push(scopeGate(changes, run.policy));
  if (failed()) return { results };
  results.push(safetyGate(changes));
  if (failed()) return { results };

  if (!(await run.workspace.apply(group.id, context.session.edits))) {
    results.push({
      gate: "checks",
      passed: false,
      detail: "The edits no longer apply on top of the fixes already kept.",
    });
    return { results };
  }
  try {
    results.push(
      await checksGate(
        run.config.app.checks,
        run.root,
        run.config.app.commandTimeoutSeconds,
      ),
    );
    if (failed()) return { results };

    await sleep(RELOAD_WAIT_MS);
    let after = await snapshot(run);
    let rescan = rescanGate(group.findings, baseline, after);
    // "Still reported" can mean the dev server had not reloaded yet. Look once more before believing it.
    if (!rescan.passed && after.failures.length === 0) {
      await sleep(RELOAD_WAIT_MS * 2);
      after = await snapshot(run);
      rescan = rescanGate(group.findings, baseline, after);
    }
    results.push(rescan);
    if (failed()) {
      if (after.failures.length > 0) {
        // The edit may have broken the page, or the dev server may have died. Without the edit, the page must scan again.
        await run.workspace.revert(group.id);
        await sleep(RELOAD_WAIT_MS);
        const check = await snapshot(run);
        if (check.failures.length > 0) {
          throw new Error(
            `The dev server stopped serving ${check.failures[0]?.target} during the run. Stopping before more budget is spent.`,
          );
        }
      }
      return { results };
    }

    const ratio = await worstPixelRatio(run, baseline, after);
    results.push(
      visualGate(ratio, run.config.fix.visualDiffThreshold, group.ruleId),
    );
    if (failed()) return { results };
    kept = true;
    return { results, after };
  } finally {
    // Also covers a gate that threw: anything short of a full pass comes back out.
    if (!kept) await run.workspace.revert(group.id);
  }
}

async function fixGroup(
  run: Run,
  group: FindingGroup,
  baseline: Snapshot,
  budgetUsd: number,
): Promise<{ outcome: FixOutcome; after?: Snapshot }> {
  const attempts: Attempt[] = [];
  const context = () => toolContext(run, group, baseline);
  const spent = () =>
    attempts.reduce((sum, attempt) => sum + attempt.costUsd, 0);
  const rejected = (reason: string, failedGate?: GateResult): FixOutcome => ({
    status: "rejected",
    group,
    attempts,
    reason,
    ...(failedGate ? { failedGate: failedGate.gate } : {}),
  });

  let model = run.models.fix;
  let agent = new Agent({
    client: run.client,
    model,
    system: run.system,
    budgetUsd,
  });
  let tools = context();
  let stop = await agent.start(tools, groupMessage(group));

  // A refusal gets one fresh try on the fallback model.
  if (stop.reason === "refusal") {
    attempts.push(attemptFrom(model, stop, tools, agent.costUsd));
    model = run.models.fallback;
    agent = new Agent({
      client: run.client,
      model,
      system: run.system,
      budgetUsd: budgetUsd - spent(),
    });
    tools = context();
    stop = await agent.start(tools, groupMessage(group));
  }

  let billed = 0;
  for (let tries = 1; ; tries++) {
    const attempt = attemptFrom(model, stop, tools, agent.costUsd - billed);
    billed = agent.costUsd;
    attempts.push(attempt);
    if (stop.reason !== "finish") return { outcome: rejected(stop.message) };

    const changes = tools.session.changes();
    if (group.tier === "suggest") {
      // Proposals are shown, never applied, so only the scope gate runs: a proposal must still stay in allowed files.
      const scope = scopeGate(changes, run.policy);
      attempt.gates = [scope];
      if (!scope.passed)
        return {
          outcome: rejected(
            `The scope gate failed: ${scope.detail.split("\n")[0]}`,
            scope,
          ),
        };
      return { outcome: { status: "suggested", group, attempts, changes } };
    }

    const gated = await gate(run, group, tools, baseline);
    attempt.gates = gated.results;
    const failedGate = gated.results.find((result) => !result.passed);
    if (failedGate === undefined && gated.after) {
      const flagged = gated.results
        .filter((result) => result.flagged)
        .map((result) => result.detail);
      const notes = [
        ...flagged,
        ...(stop.end.reviewNotes ? [stop.end.reviewNotes] : []),
      ];
      // The model can ask for review. It can never waive a review that a gate or the tier asked for.
      const needsHumanReview =
        stop.end.needsHumanReview ||
        flagged.length > 0 ||
        group.tier === "auto-review";
      return {
        outcome: {
          status: "accepted",
          group,
          attempts,
          changes,
          needsHumanReview,
          reviewNotes: notes,
        },
        after: gated.after,
      };
    }

    const reason = `The ${failedGate?.gate} gate failed: ${failedGate?.detail.split("\n")[0]}`;
    if (tries >= run.config.fix.maxAttemptsPerFinding)
      return { outcome: rejected(reason, failedGate) };
    tools = context();
    stop = await agent.resume(
      tools,
      gateFeedback(failedGate?.gate ?? "unknown", failedGate?.detail ?? ""),
    );
  }
}

/** Scan, triage, fix each group behind the gates, run the build gate, and put the working tree back. */
export async function runFix(
  options: RunFixOptions,
): Promise<Result<FixRunReport>> {
  const log = options.log ?? (() => {});

  const loaded = await loadConfig(options.cwd, options.configPath);
  if (!loaded.ok) return loaded;
  const { config, root } = loaded.value;
  if (config.app.dev === undefined)
    return fail(
      "config-invalid",
      "app.dev is required: AltShift fixes against a dev build it starts itself.",
    );
  if (config.scan.engine !== "axe")
    return fail(
      "engine-unavailable",
      `The "${config.scan.engine}" engine is not available yet. Use "axe".`,
    );

  const adapter =
    config.app.framework === "auto"
      ? await detectAdapter(root)
      : adapterFor(config.app.framework);
  if (adapter === undefined)
    return fail(
      "config-invalid",
      "No supported framework found. AltShift can fix Nuxt projects so far.",
    );

  const models = resolveModels(config.fix.models);
  try {
    requirePrice(models.fix);
    requirePrice(models.fallback);
  } catch (error) {
    if (error instanceof UnknownPriceError)
      return fail("config-invalid", error.message);
    throw error;
  }

  const journeys = await loadJourneys(root, config.targets.journeys);
  if (!journeys.ok) return journeys;
  const prompt = await loadFixPrompt(adapter.promptNotes);
  const policy: PathPolicy = {
    root,
    allowPaths: config.fix.allowPaths,
    denyPaths: config.fix.denyPaths,
  };

  log(`Starting dev server: ${config.app.dev.command}`);
  const server = await startDevServer({ ...config.app.dev, cwd: root });
  if (!server.ok) return server;
  let devServer: DevServer | undefined = server.value;

  const workspace = new Workspace(policy);
  let browser: Browser | undefined;

  // A dry run leaves the working tree exactly as it found it, whatever happened. Each step runs even if another fails.
  let cleaned = false;
  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    try {
      await workspace.restore();
    } finally {
      try {
        await browser?.close();
      } finally {
        await devServer?.stop();
      }
    }
  };
  const interrupted = () => {
    log("Interrupted. Restoring files.");
    cleanup().finally(() => process.exit(130));
  };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);

  try {
    try {
      browser = await chromium.launch();
    } catch (error) {
      return fail(
        "browser",
        `Could not start Chromium: ${errorMessage(error).split("\n")[0]}\nRun "npx playwright install chromium" and try again.`,
      );
    }

    const files: Array<{ path: string; content: string }> = [];
    for (const path of await listAllowedFiles(policy)) {
      if (/\.(?:css|scss|sass|less|pcss)$/.test(path))
        files.push({ path, content: await readFile(join(root, path), "utf8") });
    }
    const run: Run = {
      config,
      root,
      adapter,
      journeys: journeys.value,
      browser,
      policy,
      workspace,
      tokens: collectCssVariables(files),
      system: prompt.system,
      models,
      client: options.client,
      log,
      spentUsd: 0,
    };

    log("Scanning");
    let baseline = await snapshot(run);
    if (baseline.failures.length > 0) {
      const first = baseline.failures[0];
      return fail(
        "config-invalid",
        `Could not scan ${first?.target}: ${first?.message}`,
      );
    }

    const triaged = triage({
      findings: baseline.findings,
      hints: baseline.hints,
      ruleTiers: config.fix.ruleTiers,
      maxGroups: config.fix.maxFixesPerRun,
    });
    const groups = options.onlyFinding
      ? triaged.groups.filter((group) =>
          group.findings.some(
            (finding: Finding) => finding.fingerprint === options.onlyFinding,
          ),
        )
      : triaged.groups;
    if (options.onlyFinding && groups.length === 0) {
      return fail(
        "config-invalid",
        `No fixable finding has the fingerprint ${options.onlyFinding}.`,
      );
    }

    const outcomes: FixOutcome[] = [];
    for (const group of groups) {
      const remaining = config.fix.budgetUsd - run.spentUsd;
      if (remaining <= 0) {
        outcomes.push({
          status: "skipped",
          group,
          attempts: [],
          reason: "budget",
        });
        continue;
      }
      log(`Fixing ${group.ruleId} (${group.findings.length} finding(s))`);
      // One group may not take the whole run's budget.
      const share = Math.min(
        remaining,
        config.fix.budgetUsd * GROUP_BUDGET_SHARE,
      );
      const { outcome, after } = await fixGroup(run, group, baseline, share);
      run.spentUsd += outcome.attempts.reduce(
        (sum, attempt) => sum + attempt.costUsd,
        0,
      );
      outcomes.push(outcome);
      if (after) baseline = after;
      log(
        `  ${outcome.status}${outcome.status === "rejected" ? `: ${outcome.reason}` : ""}`,
      );
    }

    // The build writes to the same output folders as the dev server, so the server stops first.
    const accepted = outcomes.filter(
      (outcome) => outcome.status === "accepted",
    );
    const build = config.app.build;
    if (build === undefined) {
      for (const outcome of accepted) {
        outcome.attempts.at(-1)?.gates.push({
          gate: "build",
          passed: true,
          flagged: true,
          detail: "no build configured in app.build",
        });
        outcome.needsHumanReview = true;
        outcome.reviewNotes.push("no build configured in app.build");
      }
    }
    if (build !== undefined && accepted.length > 0) {
      await devServer.stop();
      devServer = undefined;
      log(`Building: ${build}`);
      const built = await buildGate({
        fixIds: accepted.map((outcome) => outcome.group.id),
        build: async (ids) => {
          await workspace.keepOnly(ids);
          return runCommand(build, root, config.app.commandTimeoutSeconds);
        },
      });
      for (const [index, outcome] of outcomes.entries()) {
        if (outcome.status !== "accepted") continue;
        if (built.kept.includes(outcome.group.id))
          outcome.attempts.at(-1)?.gates.push(built.result);
        else {
          const result: GateResult = {
            gate: "build",
            passed: false,
            detail: "The build failed with this fix applied.",
          };
          outcome.attempts.at(-1)?.gates.push(result);
          outcomes[index] = {
            status: "rejected",
            group: outcome.group,
            attempts: outcome.attempts,
            reason: result.detail,
            failedGate: "build",
          };
        }
      }
    }

    return ok({
      schemaVersion: 1,
      mode: "debt",
      dryRun: options.dryRun,
      outcomes,
      skippedFindings: {
        reportTier: triaged.skipped.filter(
          (item) => item.reason === "report-tier",
        ).length,
        openPr: triaged.skipped.filter((item) => item.reason === "open-pr")
          .length,
        limit: triaged.skipped.filter((item) => item.reason === "limit").length,
      },
      totalCostUsd: run.spentUsd,
      budgetUsd: config.fix.budgetUsd,
      models: [
        ...new Set(
          outcomes.flatMap((outcome) =>
            outcome.attempts.map((attempt) => attempt.model),
          ),
        ),
      ].sort(),
      promptVersion: prompt.version,
    });
  } catch (error) {
    return fail("run-failed", errorMessage(error));
  } finally {
    process.off("SIGINT", interrupted);
    process.off("SIGTERM", interrupted);
    await cleanup();
  }
}
