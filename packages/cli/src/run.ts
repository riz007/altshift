import { parseArgs } from "node:util";
import { ExitCode, runScan } from "altshift";
import { formatScanReport } from "./format.js";

const USAGE = `Usage:
  altshift scan  [--config path] [--json]
  altshift fix   [--config path] [--mode debt|pr] [--from-sarif path] [--finding fingerprint] [--dry-run] [--json]
  altshift init

scan  Start the dev server, scan every configured page and journey, and list the findings.
fix   Not available yet.
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
    case "init":
      io.stderr(`altshift ${command} is not available yet. Only "scan" works in this version.\n`);
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
      "from-sarif": { type: "string" },
      finding: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      json: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
}
