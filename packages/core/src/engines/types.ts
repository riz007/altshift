import type { Page } from "playwright";
import type { EngineId, Impact } from "../types.js";

/** What an engine reports for one element, before targets and fingerprints are attached. */
export interface RawFinding {
  ruleId: string;
  impact: Impact;
  selector: string;
  htmlSnippet: string;
  summary: string;
  helpUrl: string;
  wcag: string[];
}

export interface EngineScanOptions {
  tags: string[];
  exclude: string[];
  /** Limit the scan to these selectors. Empty means the whole page. */
  include: string[];
}

export interface EngineScanResult {
  engineVersion: string;
  findings: RawFinding[];
}

export interface ScanEngine {
  id: EngineId;
  scan(page: Page, options: EngineScanOptions): Promise<EngineScanResult>;
}
