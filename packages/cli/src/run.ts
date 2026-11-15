import { parseArgs } from "node:util";
import { ExitCode, findRepoRoot, printable, readCheckout, runScan } from "@ariamend/core";
import { anthropicClient, type FixRunReport, runDebt, runFix } from "@ariamend/fix";
import { createGitHubApi, deliveryPort } from "@ariamend/github";
import { installBrowser } from "./browser.js";
import { runEvals } from "./evals.js";
import { formatFixReport, formatScanReport } from "./format.js";

const USAGE = `Usage:
  ariamend scan  [--config path] [--json]
  ariamend fix   [--config path] [--mode debt|pr] [--from-sarif path] [--finding fingerprint] [--dry-run] [--json]
  ariamend install-browser [--with-deps]
  ariamend init
  ariamend eval  [--case glob]            (run from the Ariamend repo)

scan  Start the dev server, scan every configured page and journey, and list the findings.
fix   Ask Claude for fixes, run each one through the gates, write the evidence pack, and open or
      update one pull request. Needs ANTHROPIC_API_KEY, GITHUB_TOKEN and GITHUB_REPOSITORY.
      With --dry-run it prints the diffs and gate results and opens nothing.
      Either way your working tree is left as it was.
install-browser  Install the Chromium build this version of ariamend expects.
                 --with-deps also installs the system libraries it needs (Linux CI).
action           Run as the GitHub Action. The Action calls this; you do not need to.
init  Not available yet.
`;

export interface Io {
  cwd: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

async function scan(io: Io, configPath: string | undefined, json: boolean): Promise<ExitCode> {
  const result = await runScan({ cwd: io.cwd, configPath, log: (line) => io.stderr(`${line}\n`) });
  if (!result.ok) {
    io.stderr(`ariamend scan: ${result.error.message}\n`);
    return ExitCode.Failure;
  }

  const { report, config } = result.value;
  io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatScanReport(report, config.fix.ruleTiers));
  // Findings are the expected result of a scan. Only a target we could not scan is a failure.
  return report.failures.length > 0 ? ExitCode.Failure : ExitCode.Completed;
}

const needsKey = "ANTHROPIC_API_KEY is not set. Put it in .env.local or export it.";
const tally = (report: FixRunReport) =>
  report.outcomes.some((outcome) => outcome.status === "accepted" || outcome.status === "suggested");

async function fix(
  io: Io,
  configPath: string | undefined,
  finding: string | undefined,
  json: boolean,
): Promise<ExitCode> {
  if (!process.env.ANTHROPIC_API_KEY) {
    io.stderr(`ariamend fix: ${needsKey}\n`);
    return ExitCode.Failure;
  }
  const result = await runFix({
    cwd: io.cwd,
    configPath,
    dryRun: true,
    client: await anthropicClient(),
    onlyFinding: finding,
    log: (line) => io.stderr(`${printable(line)}\n`),
  });
  if (!result.ok) {
    io.stderr(`ariamend fix: ${result.error.message}\n`);
    return ExitCode.Failure;
  }
  const { report } = result.value;
  io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatFixReport(report));
  return tally(report) ? ExitCode.Completed : ExitCode.NothingFixed;
}

/** A real run: gate the fixes, write the evidence pack, and open or update one pull request. */
async function debt(io: Io, configPath: string | undefined, json: boolean): Promise<ExitCode> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!process.env.ANTHROPIC_API_KEY) {
    io.stderr(`ariamend fix: ${needsKey}\n`);
    return ExitCode.Failure;
  }
  if (!token || !repository) {
    io.stderr(
      "ariamend fix opens a pull request, so it needs GITHUB_TOKEN and GITHUB_REPOSITORY (owner/name).\n" +
        "To see what it would do without opening one, add --dry-run.\n",
    );
    return ExitCode.Failure;
  }
  const repoRoot = await findRepoRoot(io.cwd);
  if (repoRoot === undefined) {
    io.stderr(`ariamend fix: ${io.cwd} is not inside a git repository.\n`);
    return ExitCode.Failure;
  }

  const checkout = await readCheckout(repoRoot);
  if (checkout.changed.length > 0) {
    io.stderr(
      `ariamend fix: the working tree has changes (${checkout.changed.slice(0, 3).join(", ")}${checkout.changed.length > 3 ? ", ..." : ""}).\n` +
        "Commit or stash them first: the pull request is built from the checked-out commit.\n",
    );
    return ExitCode.Failure;
  }

  const result = await runDebt({
    cwd: io.cwd,
    configPath,
    repoRoot,
    checkedOut: checkout.head,
    client: await anthropicClient(),
    port: deliveryPort(createGitHubApi(token, repository)),
    log: (line) => io.stderr(`${printable(line)}\n`),
  });
  if (!result.ok) {
    io.stderr(`ariamend fix: ${printable(result.error.message)}\n`);
    return ExitCode.Failure;
  }
  const { report, evidence, evidenceDir, pullRequestUrl, action } = result.value;
  if (json) io.stdout(`${JSON.stringify(evidence, null, 2)}\n`);
  else {
    io.stdout(formatFixReport(report));
    io.stdout(`Evidence pack: ${evidenceDir}\n`);
    io.stdout(action === "none" ? "No pull request was opened.\n" : `Pull request ${action}: ${pullRequestUrl}\n`);
  }
  return evidence.summary.fixed > 0 ? ExitCode.Completed : ExitCode.NothingFixed;
}

export async function main(argv: string[], io: Io): Promise<ExitCode> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return ExitCode.Failure;
  }
  const { positionals, values } = parsed;

  const command = positionals[0];
  if (values.help) {
    io.stdout(USAGE);
    return ExitCode.Completed;
  }

  switch (command) {
    case "scan":
      return scan(io, values.config, values.json);
    case "fix":
      if (values.mode !== undefined && values.mode !== "debt") {
        io.stderr(`ariamend fix: mode "${values.mode}" is not available yet. Only debt mode exists.\n`);
        return ExitCode.Failure;
      }
      if (values["dry-run"]) return fix(io, values.config, values.finding, values.json);
      if (values.finding !== undefined) {
        io.stderr("ariamend fix: --finding only works with --dry-run.\n");
        return ExitCode.Failure;
      }
      return debt(io, values.config, values.json);
    case "install-browser":
      return (await installBrowser(values["with-deps"], io.stderr)) === 0 ? ExitCode.Completed : ExitCode.Failure;
    case "action": {
      const { runActionSafely } = await import("@ariamend/action");
      return (await runActionSafely()) as ExitCode;
    }
    case "eval":
      return runEvals(io, values.case);
    case "init":
      io.stderr("ariamend init is not available yet.\n");
      return ExitCode.Failure;
    case undefined:
      io.stderr(USAGE);
      return ExitCode.Failure;
    default:
      io.stderr(`Unknown command: ${command}\n\n${USAGE}`);
      return ExitCode.Failure;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: "string" },
      mode: { type: "string" },
      case: { type: "string" },
      "from-sarif": { type: "string" },
      finding: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      "with-deps": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}
