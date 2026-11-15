import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fail, loadConfig, ok, type Result } from "@ariamend/core";
import type { ModelClient } from "./agent.js";
import { buildEvidence, type EvidencePack, renderEvidence } from "./evidence.js";
import { runFix } from "./run-fix.js";
import type { FixRunReport } from "./types.js";

export interface ExistingPullRequest {
  covered: string[];
  /** Repo-relative paths. */
  files: string[];
}

/**
 * What a debt run needs from the code host. The GitHub package provides it, and the fix engine
 * never imports that package: `existing` is passed back to `deliver` untouched.
 */
export interface DeliveryPort<Existing extends ExistingPullRequest = ExistingPullRequest> {
  existing(): Promise<Result<Existing | undefined>>;
  deliver(input: {
    files: Array<{ path: string; content: string }>;
    fingerprints: string[];
    body: string;
    checkedOut: string;
    existing?: Existing;
  }): Promise<Result<{ url?: string; action: "created" | "updated" | "none" }>>;
}

export interface RunDebtOptions<Existing extends ExistingPullRequest> {
  cwd: string;
  configPath?: string;
  /** Top of the git checkout. File paths sent to the code host are relative to it. */
  repoRoot: string;
  /** The commit checked out. Callers check that the working tree has no other changes. */
  checkedOut: string;
  client: ModelClient;
  port: DeliveryPort<Existing>;
  maxFixes?: number;
  budgetUsd?: number;
  log?: (line: string) => void;
}

export interface DebtRun {
  report: FixRunReport;
  evidence: EvidencePack;
  /** Folder holding ariamend-evidence.md, ariamend-evidence.json and the screenshots. */
  evidenceDir: string;
  pullRequestUrl?: string;
  action: "created" | "updated" | "none";
}

export const EVIDENCE_DIR = ".ariamend";

/** One scheduled run: find the open pull request, fix what it does not cover, write the evidence pack, deliver. */
export async function runDebt<Existing extends ExistingPullRequest>(
  options: RunDebtOptions<Existing>,
): Promise<Result<DebtRun>> {
  const loaded = await loadConfig(options.cwd, options.configPath);
  if (!loaded.ok) return loaded;
  const { root } = loaded.value;

  const inRepo = relative(options.repoRoot, root).split(sep).join("/");
  if (inRepo.startsWith(".."))
    return fail("config-invalid", `${root} is not inside the repository at ${options.repoRoot}.`);
  const prefix = inRepo === "" ? "" : `${inRepo}/`;

  const existing = await options.port.existing();
  if (!existing.ok) return existing;

  const evidenceDir = join(root, EVIDENCE_DIR);
  const run = await runFix({
    cwd: options.cwd,
    ...(options.configPath !== undefined ? { configPath: options.configPath } : {}),
    dryRun: false,
    client: options.client,
    coveredByOpenPr: new Set(existing.value?.covered ?? []),
    lockedFiles: new Set(
      (existing.value?.files ?? []).filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)),
    ),
    screenshotDir: join(evidenceDir, "screenshots"),
    ...(options.maxFixes !== undefined ? { maxFixes: options.maxFixes } : {}),
    ...(options.budgetUsd !== undefined ? { budgetUsd: options.budgetUsd } : {}),
    ...(options.log ? { log: options.log } : {}),
  });
  if (!run.ok) return run;
  const { report, files, screenshots } = run.value;

  const linked = new Map(
    [...screenshots].map(([id, shots]) => [
      id,
      shots.map((shot) => ({ ...shot, before: `screenshots/${shot.before}`, after: `screenshots/${shot.after}` })),
    ]),
  );
  const evidence = buildEvidence(report, linked);
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(join(evidenceDir, "ariamend-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  await writeFile(join(evidenceDir, "ariamend-evidence.md"), `${renderEvidence(evidence)}\n`);

  const fingerprints = report.outcomes
    .filter((outcome) => outcome.status === "accepted")
    .flatMap((outcome) => outcome.group.findings.map((finding) => finding.fingerprint));
  const body = renderEvidence(evidence, {
    summaryOnly: true,
    detailNote:
      "The full evidence pack, with diffs, check results and before and after screenshots, is attached to the workflow run that opened this pull request.",
  });
  const delivered = await options.port.deliver({
    files: files.map((file) => ({ path: `${prefix}${file.path}`, content: file.content })),
    fingerprints,
    body,
    checkedOut: options.checkedOut,
    ...(existing.value ? { existing: existing.value } : {}),
  });
  if (!delivered.ok) return delivered;

  return ok({
    report,
    evidence,
    evidenceDir,
    action: delivered.value.action,
    ...(delivered.value.url ? { pullRequestUrl: delivered.value.url } : {}),
  });
}
