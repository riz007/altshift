import type { Page } from "playwright";

export interface CheckOptions {
  /** Extra selectors to exclude for this checkpoint only. */
  exclude?: string[];
  /** Limit the scan to these selectors. */
  include?: string[];
}

export interface JourneyContext {
  page: Page;
  /** Scan the page as it is right now. Names must be unique within a journey. */
  check(name: string, options?: CheckOptions): Promise<void>;
}

export interface Journey {
  /** Letters, digits and dashes. Used as the target name in findings. */
  name: string;
  run(ctx: JourneyContext): Promise<void>;
}

export function defineJourney(journey: Journey): Journey {
  return journey;
}
