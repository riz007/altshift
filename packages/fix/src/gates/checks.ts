import { type CommandResult, runCommand } from "@ariamend/core";
import type { GateResult } from "../types.js";

const OUTPUT_LIMIT = 3000;

export function describeFailure(result: CommandResult): string {
  const how = result.timedOut ? "timed out" : `exited with code ${result.exitCode ?? "unknown"}`;
  return `\`${result.command}\` ${how}\n${result.output.slice(-OUTPUT_LIMIT)}`;
}

/** The project's own typecheck and lint commands. Stops at the first one that fails. */
export async function checksGate(
  commands: readonly string[],
  cwd: string,
  timeoutSeconds: number,
): Promise<GateResult> {
  for (const command of commands) {
    const result = await runCommand(command, cwd, timeoutSeconds);
    if (result.timedOut || result.exitCode !== 0)
      return { gate: "checks", passed: false, detail: describeFailure(result) };
  }
  if (commands.length === 0) {
    // Nothing was verified, and the evidence should say so.
    return { gate: "checks", passed: true, flagged: true, detail: "no checks configured in app.checks" };
  }
  return { gate: "checks", passed: true, detail: `${commands.length} command(s) passed` };
}
