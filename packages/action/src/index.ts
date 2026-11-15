import { resolve } from "node:path";
import * as core from "@actions/core";
import { ExitCode, printable, readCheckout } from "@ariamend/core";
import { anthropicClient, runDebt } from "@ariamend/fix";
import { createGitHubApi, deliveryPort } from "@ariamend/github";
import { isSafeEvent, parseInputs } from "./inputs.js";

// action.yml maps every input to INPUT_* explicitly, because composite actions do not.

/**
 * The GitHub Action. It runs from the project's own installed copy of ariamend (`ariamend action`),
 * so the version is whatever the project's lockfile pins, and nothing is downloaded at run time.
 */
export async function runAction(): Promise<number> {
  const parsed = parseInputs((name) => core.getInput(name));
  if (!parsed.success) {
    core.setFailed(`Invalid inputs: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    return ExitCode.Failure;
  }
  const inputs = parsed.data;
  core.setSecret(inputs.anthropicApiKey);
  core.setSecret(inputs.githubToken);
  const licenseKey = core.getInput("license-key");
  if (licenseKey) core.setSecret(licenseKey);

  if (inputs.mode === "pr") {
    core.setFailed("Ariamend pr mode is not available yet. Use mode: debt.");
    return ExitCode.Failure;
  }
  const workspace = process.env.GITHUB_WORKSPACE;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!workspace || !repository) {
    core.setFailed("GITHUB_WORKSPACE and GITHUB_REPOSITORY must be set. This Action runs inside GitHub Actions.");
    return ExitCode.Failure;
  }

  // The Action holds write access and an API key, and runs the project's code. It must only ever run
  // on code already on the default branch: never for a pull request, a fork or a comment.
  const event = process.env.GITHUB_EVENT_NAME ?? "";
  if (!isSafeEvent(event)) {
    core.setFailed(`Ariamend only runs on schedule, workflow_dispatch or push, not on "${event}".`);
    return ExitCode.Failure;
  }
  const checkout = await readCheckout(workspace);
  if (checkout.changed.length > 0) {
    core.setFailed(
      `The checkout has changes before Ariamend started (${checkout.changed.slice(0, 3).join(", ")}). Run it on a clean checkout.`,
    );
    return ExitCode.Failure;
  }

  const result = await runDebt({
    cwd: workspace,
    configPath: resolve(workspace, inputs.config),
    repoRoot: workspace,
    checkedOut: checkout.head,
    client: await anthropicClient(inputs.anthropicApiKey),
    port: deliveryPort(createGitHubApi(inputs.githubToken, repository)),
    ...(inputs.maxFixes !== undefined ? { maxFixes: inputs.maxFixes } : {}),
    ...(inputs.budgetUsd !== undefined ? { budgetUsd: inputs.budgetUsd } : {}),
    // Log lines can quote the model and the page. Without this they could forge workflow commands.
    log: (line) => core.info(printable(line)),
  });
  if (!result.ok) {
    core.setFailed(printable(result.error.message));
    return ExitCode.Failure;
  }

  const { evidence, evidenceDir, pullRequestUrl, action } = result.value;
  core.setOutput("fixes-accepted", evidence.summary.fixed);
  core.setOutput("fixes-rejected", evidence.summary.notFixed);
  core.setOutput("fixes-suggested", evidence.summary.proposed);
  core.setOutput("cost-usd", evidence.summary.costUsd.toFixed(4));
  core.setOutput("pr-url", pullRequestUrl ?? "");
  core.setOutput("evidence-path", evidenceDir);
  core.info(
    action === "none"
      ? "No fixes passed the gates. No pull request was opened."
      : `Pull request ${action}: ${pullRequestUrl}`,
  );
  // Nothing to fix is a normal result for a scheduled job, not a failed workflow.
  return ExitCode.Completed;
}

/** Run the Action and turn an unexpected error into a failed step instead of a crash. */
export async function runActionSafely(): Promise<number> {
  try {
    return await runAction();
  } catch (error) {
    core.setFailed(printable(error instanceof Error ? error.message : String(error)));
    return ExitCode.Failure;
  }
}
