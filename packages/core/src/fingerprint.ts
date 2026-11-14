import { createHash } from "node:crypto";
import type { EngineId } from "./types.js";

/** Bump when the input below or selector normalization changes. */
export const FINGERPRINT_VERSION = 1;

export interface FingerprintInput {
  engine: EngineId;
  ruleId: string;
  target: string;
  checkpoint: string;
  normalizedSelector: string;
}

export function fingerprint(input: FingerprintInput): string {
  const parts = [
    FINGERPRINT_VERSION,
    input.engine,
    input.ruleId,
    input.target,
    input.checkpoint,
    input.normalizedSelector,
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}
