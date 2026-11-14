import * as core from "@actions/core";
import { ExitCode } from "altshift";

// action.yml maps every input to INPUT_* explicitly, because composite actions do not.

const MODES = ["debt", "pr"] as const;
type Mode = (typeof MODES)[number];

function readMode(): Mode {
  const raw = core.getInput("mode") || "debt";
  if ((MODES as readonly string[]).includes(raw)) return raw as Mode;
  throw new Error(`Unknown mode "${raw}". Use one of: ${MODES.join(", ")}.`);
}

async function run(): Promise<number> {
  const apiKey = core.getInput("anthropic-api-key");
  if (apiKey) core.setSecret(apiKey);
  const licenseKey = core.getInput("license-key");
  if (licenseKey) core.setSecret(licenseKey);

  const mode = readMode();
  core.setFailed(`altshift ${mode} mode is not available yet.`);
  return ExitCode.Failure;
}

run().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    core.setFailed(error instanceof Error ? error.message : String(error));
    process.exitCode = ExitCode.Failure;
  },
);
