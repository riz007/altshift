export const IMPACTS = ["minor", "moderate", "serious", "critical", "unknown"] as const;
export type Impact = (typeof IMPACTS)[number];

export const ENGINES = ["axe", "accesslint"] as const;
export type EngineId = (typeof ENGINES)[number];

/** Checkpoint name used for plain page loads. */
export const PAGE_CHECKPOINT = "load";

export interface Finding {
  /** Matches the same finding between a before and an after scan. */
  fingerprint: string;
  engine: EngineId;
  /** axe rule ID. Other engines are mapped to axe IDs. */
  ruleId: string;
  impact: Impact;
  /** Page path ("/cart") or journey name ("cart-open"). */
  target: string;
  checkpoint: string;
  url: string;
  selector: string;
  /** Selector with generated class suffixes and dynamic IDs removed. This is the fingerprint input. */
  normalizedSelector: string;
  /** Untrusted page content. Escape before rendering anywhere. */
  htmlSnippet: string;
  summary: string;
  helpUrl: string;
  /** WCAG success criteria, e.g. ["1.1.1"]. */
  wcag: string[];
}

export interface ScannedCheckpoint {
  target: string;
  checkpoint: string;
  url: string;
}

export interface ScanFailure {
  target: string;
  checkpoint?: string;
  message: string;
}

/** No timestamps, and every list is sorted, so two scans of the same build serialize identically. */
export interface ScanReport {
  schemaVersion: 1;
  fingerprintVersion: number;
  engine: { id: EngineId; version: string };
  scanned: ScannedCheckpoint[];
  findings: Finding[];
  failures: ScanFailure[];
}

/** Only the CLI and the Action turn results into these. */
export const ExitCode = {
  Completed: 0,
  NothingFixed: 1,
  Failure: 2,
} as const;
export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/** Statements every PR body, evidence pack and scan summary must carry. */
export const HONESTY = {
  scan: "These are automated findings on the tested pages and states. Automated tools find only part of WCAG issues, so manual testing is still needed.",
  fix: "This change cleared the named automated finding and passed the listed gates. A person still needs to review it.",
  evidence:
    "These automated findings were fixed on the tested pages and states. Automated tools find only part of WCAG issues, so manual testing is still needed.",
  draft: "Draft: please review.",
} as const;
