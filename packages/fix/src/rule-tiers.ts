// Default fix tiers per axe rule.
// Moving a rule into "auto" needs an a11y-reviewer pass and an eval run.

export type FixTier = "auto" | "auto-review" | "suggest" | "report";

export const DEFAULT_RULE_TIERS: Readonly<Record<string, FixTier>> = {
  // Fixable without knowing what the content means and without visual change.
  "button-name": "auto",
  "link-name": "auto",
  "input-button-name": "auto",
  label: "auto",
  "select-name": "auto",
  "aria-allowed-attr": "auto",
  "aria-required-attr": "auto",
  "aria-valid-attr": "auto",
  "aria-valid-attr-value": "auto",
  "aria-hidden-focus": "auto",
  "aria-dialog-name": "auto",
  "frame-title": "auto",
  list: "auto",
  listitem: "auto",
  "duplicate-id-aria": "auto",
  "nested-interactive": "auto",

  // The model writes content a person must check.
  "image-alt": "auto-review",
  "svg-img-alt": "auto-review",
  "role-img-alt": "auto-review",
  "input-image-alt": "auto-review",
  "area-alt": "auto-review",

  // Visual or design-token changes. Proposed in the comment, never applied.
  "color-contrast": "suggest",
  "target-size": "suggest",
  "scrollable-region-focusable": "suggest",
  "meta-viewport": "suggest",
  "heading-order": "suggest",

  // Fixed in script or config (useHead, nuxt.config), which automatic fixes may not touch.
  "html-has-lang": "suggest",
  "html-lang-valid": "suggest",
  "document-title": "suggest",

  // Needs content only a person can supply.
  "video-caption": "report",
  "audio-caption": "report",
};

/** Rules not listed default to "report": unknown rules are never auto-fixed. */
export function tierFor(ruleId: string, overrides: Readonly<Record<string, FixTier>> = {}): FixTier {
  return overrides[ruleId] ?? DEFAULT_RULE_TIERS[ruleId] ?? "report";
}

/** Rules where a visual change is expected, so the visual gate flags instead of failing. */
export const VISUAL_CHANGE_EXPECTED: ReadonlySet<string> = new Set(["color-contrast", "target-size"]);
