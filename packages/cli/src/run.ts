import { parseArgs } from "node:util";
import { anthropicClient, runFix } from "@altshift/fix";
import { ExitCode, printable, runScan } from "altshift";
import { runEvals } from "./evals.js";
import { formatFixReport, formatScanReport } from "./format.js";

const USAGE = `Usage:
  altshift scan  [--config path] [--json]
  altshift fix   [--config path] [--mode debt|pr] [--from-sarif path] [--finding fingerprint] [--dry-run] [--json]
  altshift init
  altshift eval  [--case glob]            (run from the AltShift repo)

scan  Start the dev server, scan every configured page and journey, and list the findings.
fix   Ask Claude for fixes and run each one through the gates. Only --dry-run works so far:
      it prints the diffs and gate results, then puts your files back. Needs ANTHROPIC_API_KEY.
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
    io.stderr(`altshift scan: ${result.error.message}\n`);
    return ExitCode.Failure;
  }

  const { report, config } = result.value;
  io.stdout(json ? `${JSON.stringify(report, null, 2)}\n` : formatScanReport(report, config.fix.ruleTiers));
  // Findings are the expected result of a scan. Only a target we could not scan is a failure.
  return report.failures.length > 0 ? ExitCode.Failure : ExitCode.Completed;
}

async function fix(
  io: Io,
  configPath: string | undefined,
  finding: string | undefined,
  json: boolean,
): Promise<ExitCode> {
  if (!process.env.ANTHROPIC_API_KEY) {
    io.stderr("altshift fix: ANTHROPIC_API_KEY is not set. Put it in .env.local or export it.\n");
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
    io.stderr(`altshift fix: ${result.error.message}\n`);
    return ExitCode.Failure;
  }
  io.stdout(json ? `${JSON.stringify(result.value, null, 2)}\n` : formatFixReport(result.value));
  const delivered = result.value.outcomes.some(
    (outcome) => outcome.status === "accepted" || outcome.status === "suggested",
  );
  return delivered ? ExitCode.Completed : ExitCode.NothingFixed;
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
      if (!values["dry-run"]) {
        io.stderr("altshift fix only supports --dry-run so far. Opening pull requests is not built yet.\n");
        return ExitCode.Failure;
      }
      return fix(io, values.config, values.finding, values.json);
    case "eval":
      return runEvals(io, values.case);
    case "init":
      io.stderr("altshift init is not available yet.\n");
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
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}
