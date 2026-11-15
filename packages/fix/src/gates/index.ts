import type { GateResult } from "../types.js";

export * from "./build.js";
export * from "./checks.js";
export * from "./rescan.js";
export * from "./safety.js";
export * from "./scope.js";
export * from "./visual.js";

export interface GateRun {
  /** True only when at least one gate ran and every gate passed. */
  passed: boolean;
  results: GateResult[];
}

/** Run gates in the given order and stop at the first failure. Later gates do not run. */
export async function runGates(steps: ReadonlyArray<() => GateResult | Promise<GateResult>>): Promise<GateRun> {
  const results: GateResult[] = [];
  for (const step of steps) {
    const result = await step();
    results.push(result);
    if (!result.passed) return { passed: false, results };
  }
  return { passed: results.length > 0, results };
}
export * from "./vue-sfc.js";
