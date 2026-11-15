import type { CommandResult } from "@ariamend/core";
import type { GateResult } from "../types.js";
import { describeFailure } from "./checks.js";

export interface BuildGateInput {
  /** Kept fixes, in the order they were accepted. */
  fixIds: readonly string[];
  /** Put exactly these fixes on disk and run the build. */
  build: (activeIds: readonly string[]) => Promise<CommandResult>;
}

export interface BuildGateOutcome {
  result: GateResult;
  kept: string[];
  dropped: string[];
}

/**
 * Build once with every kept fix. If that fails, drop the newest fix and try again until the build passes.
 * With no fixes left and the build still failing, the project was broken before we touched it.
 */
export async function buildGate(input: BuildGateInput): Promise<BuildGateOutcome> {
  const kept = [...input.fixIds];
  const dropped: string[] = [];
  let lastFailure = "";

  while (kept.length > 0) {
    const result = await input.build(kept);
    if (!result.timedOut && result.exitCode === 0) {
      const detail =
        dropped.length === 0
          ? "build passed"
          : `build passed after dropping ${dropped.length} fix(es): ${dropped.join(", ")}`;
      return { result: { gate: "build", passed: true, detail, flagged: dropped.length > 0 }, kept, dropped };
    }
    lastFailure = describeFailure(result);
    dropped.push(kept.pop() as string);
  }

  if (input.fixIds.length === 0)
    return { result: { gate: "build", passed: true, detail: "nothing to build" }, kept, dropped };
  return { result: { gate: "build", passed: false, detail: lastFailure }, kept, dropped };
}
