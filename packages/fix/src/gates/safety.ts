import { HONESTY } from "altshift";
import type { FileChange } from "../diff.js";
import type { GateResult } from "../types.js";
import { parseTemplate, splitSfc, type TemplateAttribute, type TemplateTag } from "./vue-template.js";

// The checks, rescan and build gates run the project's code, so an edit must not be able to add code.
// That cannot be decided by searching for dangerous strings. This gate works the other way round:
// only the <template> of a Vue component may change, and every new tag, attribute, binding and
// piece of text must be on a short list of things an accessibility fix needs.

const STATIC_ATTRIBUTES = /^(?:aria-[a-z]+|alt|title|lang|role|id|for|type|tabindex|class|name|autocomplete|scope)$/;

const ADDABLE_TAGS = new Set(
  "span label li ul ol dl dt dd p div legend fieldset caption title desc strong em abbr h1 h2 h3 h4 h5 h6 button th td section nav main header footer".split(
    " ",
  ),
);

// Removing one of these takes something away from users, so the count per tag name must not drop.
const KEPT_TAGS =
  /^(?:a|button|input|select|textarea|label|img|svg|ul|ol|li|dl|dt|dd|h[1-6]|table|tr|th|td|form|nav|main|video|audio|iframe|details|summary|dialog)$/;
const isComponent = (name: string) => /[A-Z-]/.test(name);

const STATE_ATTRIBUTES = /^aria-(?:checked|expanded|pressed|selected)$/;
const NAME_ATTRIBUTES = /^(?:aria-label|alt|title)$/;
const HIDING_CLASS = /(?:^|:)(?:hidden|invisible|d-none|opacity-0|collapse)$/;
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|(?:^|[\s"'(])\/\/[\w-]+\./i;
const DISABLE_COMMENT = /(?:axe|eslint|biome|oxlint|stylelint|ts)-?(?:disable|ignore|nocheck|expect-error)/i;
const MAX_VALUE_LENGTH = 200;

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const PATH = `!?${IDENTIFIER}(?:\\.${IDENTIFIER})*`;
const LITERAL = `(?:'[^'\\\\\`$]*'|"[^"\\\\\`$]*")`;
const TRANSLATE = `\\$?t\\(\\s*${LITERAL}\\s*\\)`;
const VALUE = `(?:${LITERAL}|${TRANSLATE})`;
// A property path, a string, a translation call, or a choice between two strings. Nothing that can call other code.
const SIMPLE_EXPRESSION = new RegExp(`^(?:${PATH}|${VALUE}|${PATH}\\s*\\?\\s*${VALUE}\\s*:\\s*${VALUE})$`);
const FORBIDDEN_IDENTIFIER =
  /(?:^|[.!\s])(?:process|globalThis|window|document|self|global|constructor|__proto__|prototype|eval|Function|import|require|\$config|\$nuxt|useRuntimeConfig)(?:$|[.\s?])/;

function isSimpleExpression(expression: string): boolean {
  const trimmed = expression.trim();
  return SIMPLE_EXPRESSION.test(trimmed) && !FORBIDDEN_IDENTIFIER.test(trimmed);
}

function count<T>(items: Iterable<T>, key: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/** Take one from the bag if it is there. False means the item is new. */
function take(bag: Map<string, number>, key: string): boolean {
  const left = bag.get(key) ?? 0;
  if (left === 0) return false;
  bag.set(key, left - 1);
  return true;
}

const attributeKey = (attribute: TemplateAttribute) =>
  attribute.value === null ? attribute.name : `${attribute.name}=${attribute.value}`;

function boundName(name: string): string | undefined {
  return /^(?::|v-bind:)([a-z][\w-]*)$/.exec(name)?.[1];
}

interface Verdict {
  problems: string[];
  review: string[];
}

function checkNewAttribute(
  tag: TemplateTag,
  attribute: TemplateAttribute,
  replacedClasses: Map<string, number>,
  verdict: Verdict,
): void {
  const bound = boundName(attribute.name);
  const name = bound ?? attribute.name;
  const shown = attribute.value === null ? attribute.name : `${attribute.name}="${attribute.value.slice(0, 60)}"`;
  const value = attribute.value ?? "";
  const literal = bound === undefined ? value : (/^(['"])(.*)\1$/.exec(value.trim())?.[2] ?? undefined);

  if (!STATIC_ATTRIBUTES.test(name)) {
    verdict.problems.push(`adds ${shown}. Only naming, labelling, role and ARIA attributes can be added automatically`);
    return;
  }
  if (bound !== undefined && !isSimpleExpression(value)) {
    verdict.problems.push(`adds ${shown}. A binding may only read a value, pick between two strings, or call $t()`);
    return;
  }
  if (value.length > MAX_VALUE_LENGTH || URL_LIKE.test(value)) {
    verdict.problems.push(`adds ${shown}, which is too long or contains a URL`);
    return;
  }

  const has = (pattern: RegExp) => tag.attributes.some((other) => pattern.test(other.name));
  const interactive = /^(?:a|button|input|select|textarea|summary)$/i.test(tag.name) || isComponent(tag.name);

  if (name === "aria-hidden") {
    if (!/^(?:svg|i)$/.test(tag.name))
      verdict.problems.push(`adds aria-hidden to <${tag.name}>. Fix the element instead of hiding it`);
    else verdict.review.push("adds aria-hidden to an icon");
  }
  const addedClasses = value.split(/\s+/).filter((token) => !take(replacedClasses, token));
  if (name === "class" && bound === undefined && addedClasses.some((token) => HIDING_CLASS.test(token))) {
    verdict.problems.push(`adds a class that hides the element (${shown})`);
  }
  if (name === "role" && /^(?:presentation|none)$/.test(literal ?? value)) {
    if (/^(?:img|svg)$/.test(tag.name)) verdict.review.push(`adds role="${literal ?? value}" to an image`);
    else verdict.problems.push(`adds role="${literal ?? value}" to <${tag.name}>, which removes its meaning`);
  }
  if (STATE_ATTRIBUTES.test(name) && bound === undefined) {
    verdict.problems.push(
      `adds a fixed ${shown}. Bind it to the component's state so it changes when the control does`,
    );
  }
  if (/^aria-label(?:ledby)?$/.test(name) && /^(?:div|span|p)$/.test(tag.name) && !has(/^:?role$/)) {
    verdict.problems.push(`adds ${name} to a <${tag.name}> with no role, where assistive technology ignores it`);
  }
  if (name === "tabindex") {
    if (/^-/.test((literal ?? value).trim())) verdict.review.push('adds tabindex="-1"');
    else if (!interactive && !has(/^:?role$/)) verdict.problems.push(`adds ${shown} to a <${tag.name}> with no role`);
  }
  if (name === "alt" && (attribute.value === null || (literal ?? value) === ""))
    verdict.review.push('adds an empty alt=""');
  if (NAME_ATTRIBUTES.test(name) && (literal ?? "") !== "") {
    verdict.review.push(`${HONESTY.draft} New ${name}: "${(literal ?? "").slice(0, 80)}"`);
  }
}

function checkTemplate(before: string, after: string, verdict: Verdict): void {
  const was = parseTemplate(before);
  const now = parseTemplate(after);
  if (!was || !now) {
    verdict.problems.push("the template could not be read");
    return;
  }

  const tagsBefore = count(was.tags, (tag) => tag.name);
  const tagsAfter = count(now.tags, (tag) => tag.name);
  for (const [name, had] of tagsBefore) {
    const has = tagsAfter.get(name) ?? 0;
    if (has < had && (KEPT_TAGS.test(name) || isComponent(name))) {
      verdict.problems.push(`removes ${had - has} <${name}> element(s). Fix the element instead of removing it`);
    }
  }
  for (const [name, has] of tagsAfter) {
    if (has > (tagsBefore.get(name) ?? 0) && !ADDABLE_TAGS.has(name)) verdict.problems.push(`adds a <${name}> element`);
  }
  if (now.tags.length < was.tags.length) {
    verdict.problems.push(`removes ${was.tags.length - now.tags.length} element(s) overall`);
  }

  const attributesBefore = count(
    was.tags.flatMap((tag) => tag.attributes),
    attributeKey,
  );
  const added: Array<[TemplateTag, TemplateAttribute]> = [];
  for (const tag of now.tags) {
    for (const attribute of tag.attributes) {
      if (!take(attributesBefore, attributeKey(attribute))) added.push([tag, attribute]);
    }
  }
  // A rewritten class attribute shows up as one removed and one added. Only tokens the rewrite
  // brought in count as new, so editing an element that was already hidden is not blamed.
  const replacedClasses = count(
    [...attributesBefore].flatMap(([key, left]) =>
      left > 0 && key.startsWith("class=") ? key.slice(6).split(/\s+/) : [],
    ),
    (token) => token,
  );
  for (const [tag, attribute] of added) checkNewAttribute(tag, attribute, replacedClasses, verdict);

  // Whatever is left in the bag was removed or rewritten.
  for (const [key, left] of attributesBefore) {
    if (left === 0) continue;
    const name = (key.split("=")[0] ?? key).replace(/^(?::|v-bind:)/, "");
    if (!STATIC_ATTRIBUTES.test(name)) verdict.problems.push(`removes or changes ${key.slice(0, 60)}`);
    else if (name === "role")
      verdict.problems.push(`removes or changes ${key}. Keep the role and supply what it needs`);
    else if (/^aria-(?!hidden|label)/.test(name)) verdict.review.push(`removes or changes ${key.slice(0, 60)}`);
  }

  const textsBefore = count(was.texts, (text) => text);
  for (const text of now.texts) {
    if (take(textsBefore, text)) continue;
    for (const [, expression = ""] of text.matchAll(/\{\{([\s\S]*?)\}\}/g)) {
      if (!isSimpleExpression(expression)) verdict.problems.push(`adds {{ ${expression.trim().slice(0, 60)} }}`);
    }
    const literal = text.replace(/\{\{[\s\S]*?\}\}/g, "").trim();
    if (/[{}]/.test(literal) || URL_LIKE.test(literal) || literal.length > MAX_VALUE_LENGTH) {
      verdict.problems.push("adds text that is too long, contains a URL or contains template syntax");
    } else if (literal !== "") {
      verdict.review.push(`${HONESTY.draft} New text: "${literal.slice(0, 80)}"`);
    }
  }

  const commentsBefore = count(was.comments, (comment) => comment);
  for (const comment of now.comments) {
    if (!take(commentsBefore, comment) && DISABLE_COMMENT.test(comment))
      verdict.problems.push("adds a comment that disables a check");
  }
}

/**
 * Allow only template changes that an accessibility fix needs, and nothing that can run code,
 * load something external, or hide or remove the element the finding is about.
 */
export function safetyGate(changes: readonly FileChange[]): GateResult {
  const problems: string[] = [];
  const review: string[] = [];

  for (const change of changes) {
    const verdict: Verdict = { problems: [], review: [] };
    if (!change.path.endsWith(".vue")) {
      verdict.problems.push("only Vue component templates can be changed automatically");
    } else {
      const before = splitSfc(change.before);
      const after = splitSfc(change.after);
      if (!before.ok) verdict.problems.push(before.reason);
      else if (!after.ok) verdict.problems.push(after.reason);
      else if (before.outside !== after.outside) {
        verdict.problems.push("changes code outside <template>. Script and style changes need a person");
      } else {
        checkTemplate(before.template, after.template, verdict);
      }
    }
    problems.push(...verdict.problems.map((message) => `${change.path}: ${message}`));
    review.push(...verdict.review.map((message) => `${change.path}: ${message}`));
  }

  if (problems.length > 0) return { gate: "safety", passed: false, detail: [...new Set(problems)].sort().join("\n") };
  if (review.length > 0)
    return { gate: "safety", passed: true, flagged: true, detail: [...new Set(review)].sort().join("\n") };
  return { gate: "safety", passed: true, detail: "template-only change with no new code paths" };
}
