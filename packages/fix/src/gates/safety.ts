import { HONESTY } from "altshift";
import type { FileChange } from "../diff.js";
import type { GateResult } from "../types.js";
import {
  parseTemplate,
  splitSfc,
  type TemplateAttribute,
  type TemplateTag,
} from "./vue-template.js";

// The checks, rescan and build gates run the project's code, so an edit must not be able to add code.
// That cannot be decided by searching for dangerous strings. This gate works the other way round:
// only the <template> of a Vue component may change, and every new tag, attribute, binding and
// piece of text must be on a short list of things an accessibility fix needs.

const STATIC_ATTRIBUTES =
  /^(?:aria-[a-z]+|alt|title|lang|role|id|for|type|tabindex|class|name|autocomplete|scope)$/;

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
const NAME_ATTRIBUTES =
  /^(?:aria-label|alt|title|aria-description|aria-valuetext|aria-placeholder)$/;
const REFERENCE_ATTRIBUTES = /^aria-(?:labelledby|describedby)$/;
// On these elements a name is ignored or not allowed unless a role says otherwise.
const NO_NAME_WITHOUT_ROLE =
  /^(?:div|span|p|label|legend|caption|strong|em|abbr|li|dt|dd)$/;
const WATCHED_REMOVALS =
  /^(?:aria-label|aria-labelledby|aria-describedby|alt|id|for|autocomplete|lang)$/;
const HIDING_CLASS = /(?:^|:)(?:hidden|invisible|d-none|opacity-0|collapse)$/;
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|(?:^|[\s"'(])\/\/[\w-]+\./i;
const DISABLE_COMMENT =
  /(?:axe|eslint|biome|oxlint|stylelint|ts)-?(?:disable|ignore|nocheck|expect-error)/i;
const MAX_VALUE_LENGTH = 200;

const IDENTIFIER = "[A-Za-z_$][\\w$]*";
const PLAIN_PATH = `${IDENTIFIER}(?:\\.${IDENTIFIER})*`;
const PATH = `!?${PLAIN_PATH}`;
const LITERAL = `(?:'[^'\\\\\`$]*'|"[^"\\\\\`$]*")`;
const TRANSLATE = `\\$?t\\(\\s*${LITERAL}\\s*\\)`;
// A template string whose placeholders only read values: `Save ${product.name} to wishlist`.
const TEMPLATE = `\`(?:[^\`\\\\$]|\\$\\{\\s*${PLAIN_PATH}\\s*\\})*\``;
const VALUE = `(?:${LITERAL}|${TRANSLATE}|${TEMPLATE})`;
// A property path, a string, a translation call, or a choice between two strings. Nothing that can call other code.
const SIMPLE_EXPRESSION = new RegExp(
  `^(?:${PATH}|${VALUE}|${PATH}\\s*\\?\\s*${VALUE}\\s*:\\s*${VALUE})$`,
);
const CONSTANTS = new Set(["true", "false", "null", "undefined"]);
const FORBIDDEN_IDENTIFIER =
  /(?<![\w$])(?:process|globalThis|window|document|self|global|constructor|__proto__|prototype|eval|Function|import|require|useRuntimeConfig)(?![\w$])/;

/** The parts of an expression that are code: quoted text is dropped, template placeholders are kept. */
function codeOf(expression: string): string {
  return expression
    .replace(/`[^`]*`/g, (template) =>
      [...template.matchAll(/\$\{([^}]*)\}/g)]
        .map((match) => match[1])
        .join(" "),
    )
    .replace(/'[^']*'|"[^"]*"/g, " ");
}

/** Every piece of fixed text in an expression: quoted strings and template strings with no placeholder. */
function literalsOf(expression: string): string[] {
  return [...expression.matchAll(/'([^']*)'|"([^"]*)"|`([^`$]*)`/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? "",
  );
}

/** The first name of each property path, e.g. "product" in product.name. */
function rootsOf(expression: string): string[] {
  return [...codeOf(expression).matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map(
    (match) => match[0],
  );
}

/**
 * Why an expression may not be added, or undefined when it is fine.
 * It must match the small grammar, and may only read names the template already uses: a fix has no
 * reason to surface data the component never showed, such as route parameters or runtime config.
 */
function expressionProblem(
  expression: string,
  known: ReadonlySet<string>,
): string | undefined {
  const trimmed = expression.trim();
  // Vue decodes HTML entities before it parses an expression, so an encoded quote would end a string early.
  if (trimmed.includes("&")) return "contains an HTML entity";
  if (
    !SIMPLE_EXPRESSION.test(trimmed) ||
    FORBIDDEN_IDENTIFIER.test(codeOf(trimmed))
  ) {
    return "may only read a value, pick between two strings, or call $t()";
  }
  for (const root of rootsOf(trimmed)) {
    if (
      CONSTANTS.has(root) ||
      root === "$t" ||
      root === "t" ||
      root === "$props"
    )
      continue;
    if (/^[$_]/.test(root)) return `reads ${root}, a framework internal`;
    if (!known.has(root))
      return `reads "${root}", which this template does not already use`;
  }
  return undefined;
}

function count<T>(
  items: Iterable<T>,
  key: (item: T) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const item of items)
    counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

/** Take one from the bag if it is there. False means the item is new. */
function take(bag: Map<string, number>, key: string): boolean {
  const left = bag.get(key) ?? 0;
  if (left === 0) return false;
  bag.set(key, left - 1);
  return true;
}

const baseName = (name: string) => name.replace(/^(?::|v-bind:)(?=[a-z])/, "");
const isAllowlisted = (attribute: TemplateAttribute) =>
  STATIC_ATTRIBUTES.test(baseName(attribute.name));
const attributeKey = (attribute: TemplateAttribute) =>
  attribute.value === null
    ? attribute.name
    : `${attribute.name}=${attribute.value}`;

/** Handlers, directives and everything else outside the allowlist. A fix must leave these exactly where they are. */
function behaviour(tag: TemplateTag): string {
  return tag.attributes
    .filter((attribute) => !isAllowlisted(attribute))
    .map(attributeKey)
    .sort()
    .join("  ");
}

interface Verdict {
  problems: string[];
  review: string[];
}

interface Context {
  replacedClasses: Map<string, number>;
  /** Names that expressions in the template already read. */
  known: ReadonlySet<string>;
  existingIds: ReadonlySet<string>;
  verdict: Verdict;
}

function checkNewAttribute(
  tag: TemplateTag,
  attribute: TemplateAttribute,
  context: Context,
): void {
  const { verdict } = context;
  const name = baseName(attribute.name);
  const bound = name !== attribute.name;
  const value = attribute.value ?? "";
  const shown =
    attribute.value === null
      ? attribute.name
      : `${attribute.name}="${value.slice(0, 60)}"`;

  if (bound) {
    const problem = expressionProblem(value, context.known);
    if (problem !== undefined) {
      verdict.problems.push(`adds ${shown}, which ${problem}`);
      return;
    }
  }
  if (value.length > MAX_VALUE_LENGTH || URL_LIKE.test(value)) {
    verdict.problems.push(`adds ${shown}, which is too long or contains a URL`);
    return;
  }

  // Fixed text is checked the same way whether it is written plainly or inside a binding.
  const literals = bound ? literalsOf(value) : [value];
  const readsState =
    bound &&
    rootsOf(value).some(
      (root) => !CONSTANTS.has(root) && root !== "$t" && root !== "t",
    );
  const has = (pattern: RegExp) =>
    tag.attributes.some((other) => pattern.test(baseName(other.name)));
  const interactive =
    /^(?:a|button|input|select|textarea|summary)$/i.test(tag.name) ||
    isComponent(tag.name);

  if (name === "aria-hidden") {
    if (!/^(?:svg|i)$/.test(tag.name))
      verdict.problems.push(
        `adds aria-hidden to <${tag.name}>. Fix the element instead of hiding it`,
      );
    else verdict.review.push("adds aria-hidden to an icon");
  }
  if (name === "aria-roledescription")
    verdict.problems.push(
      "adds aria-roledescription, which replaces the role users hear",
    );
  if (name === "class") {
    const tokens = literals.flatMap((literal) => literal.split(/\s+/));
    const added = bound
      ? tokens
      : tokens.filter((token) => !take(context.replacedClasses, token));
    if (added.some((token) => HIDING_CLASS.test(token)))
      verdict.problems.push(`adds a class that hides the element (${shown})`);
  }
  if (
    name === "role" &&
    literals.some((literal) => /^(?:presentation|none)$/.test(literal))
  ) {
    if (/^(?:img|svg)$/.test(tag.name))
      verdict.review.push("gives an image a presentation role");
    else
      verdict.problems.push(
        `gives <${tag.name}> a presentation role, which removes its meaning`,
      );
  }
  if (STATE_ATTRIBUTES.test(name) && !readsState) {
    verdict.problems.push(
      `adds a fixed ${shown}. Bind it to the component's state so it changes when the control does`,
    );
  }
  if (
    /^aria-label(?:ledby)?$/.test(name) &&
    NO_NAME_WITHOUT_ROLE.test(tag.name) &&
    !has(/^role$/)
  ) {
    verdict.problems.push(
      `adds ${name} to a <${tag.name}> with no role, where assistive technology ignores it`,
    );
  }
  if (name === "aria-label" && value.includes("?") && has(/^aria-pressed$/)) {
    verdict.problems.push(
      "makes the name change with state on a toggle that has aria-pressed. Keep one name",
    );
  }
  if (name === "tabindex") {
    if (literals.some((literal) => /^\s*-/.test(literal)))
      verdict.review.push('adds tabindex="-1"');
    else if (!interactive && !has(/^role$/))
      verdict.problems.push(`adds ${shown} to a <${tag.name}> with no role`);
  }
  if (name === "id" && !bound) {
    if (context.existingIds.has(value))
      verdict.problems.push(
        `adds id "${value}", which is already used in this template`,
      );
    else
      verdict.review.push(
        `adds a fixed id "${value}". If this component can appear twice on a page, the ids will clash`,
      );
  }
  if (REFERENCE_ATTRIBUTES.test(name)) {
    verdict.review.push(
      `${HONESTY.draft} ${name} now takes this control's text from "${value}": check that text describes it`,
    );
  }

  if (!NAME_ATTRIBUTES.test(name)) return;
  const empty =
    attribute.value === null ||
    (literals.length === 1 && literals[0] === "" && !readsState);
  if (name === "alt" && empty) {
    verdict.review.push(
      'adds an empty alt="", which tells assistive technology to skip the image',
    );
    return;
  }
  if (value === "") return;
  // Any new name is the model's choice, whether it wrote the words or picked the field to bind.
  const how =
    !bound || literals.length > 0
      ? `New ${name}: ${JSON.stringify(value.slice(0, 80))}.`
      : `${name} is bound to ${value}: check this field describes this control.`;
  const translated = /\$?t\(/.test(codeOf(value))
    ? " The translation key was not checked."
    : "";
  const unseen =
    name === "alt" || /^(?:svg|img)$/.test(tag.name)
      ? " The image itself was not viewed."
      : "";
  verdict.review.push(`${HONESTY.draft} ${how}${translated}${unseen}`);
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
      verdict.problems.push(
        `removes ${had - has} <${name}> element(s). Fix the element instead of removing it`,
      );
    }
  }
  for (const [name, has] of tagsAfter) {
    if (has > (tagsBefore.get(name) ?? 0) && !ADDABLE_TAGS.has(name))
      verdict.problems.push(`adds a <${name}> element`);
  }
  if (now.tags.length < was.tags.length) {
    verdict.problems.push(
      `removes ${was.tags.length - now.tags.length} element(s) overall`,
    );
  }

  // Handlers and directives are compared per element, so moving a v-if or a click handler onto
  // another element is seen, not just adding or deleting one.
  const behaviourBefore = count(
    was.tags.map(behaviour).filter(Boolean),
    (item) => item,
  );
  for (const tag of now.tags) {
    const signature = behaviour(tag);
    if (signature !== "" && !take(behaviourBefore, signature)) {
      verdict.problems.push(
        `adds, changes or moves a handler, directive or other attribute on <${tag.name}> (${signature.slice(0, 80)})`,
      );
    }
  }
  for (const [signature, left] of behaviourBefore) {
    if (left > 0)
      verdict.problems.push(
        `removes or changes a handler, directive or other attribute (${signature.slice(0, 80)})`,
      );
  }

  const dynamic = (tags: TemplateTag[]) =>
    tags.flatMap((tag) =>
      tag.attributes.filter((item) => /^(?::|v-|@|#)/.test(item.name)),
    );
  const known = new Set(
    [
      ...dynamic(was.tags).map((item) => item.value ?? ""),
      ...was.texts.flatMap((text) =>
        [...text.matchAll(/\{\{([\s\S]*?)\}\}/g)].map(
          (match) => match[1] ?? "",
        ),
      ),
    ].flatMap((code) => codeOf(code).match(/[A-Za-z_$][\w$]*/g) ?? []),
  );
  const existingIds = new Set(
    was.tags.flatMap((tag) =>
      tag.attributes
        .filter((item) => item.name === "id")
        .map((item) => item.value ?? ""),
    ),
  );

  // Allowlisted attributes are tracked per tag name, so moving aria-hidden from an icon to a control counts as new.
  const keyed = (tag: TemplateTag, attribute: TemplateAttribute) =>
    `${tag.name}|${attributeKey(attribute)}`;
  const attributesBefore = count(
    was.tags.flatMap((tag) =>
      tag.attributes
        .filter(isAllowlisted)
        .map((attribute) => keyed(tag, attribute)),
    ),
    (key) => key,
  );
  const added: Array<[TemplateTag, TemplateAttribute]> = [];
  for (const tag of now.tags) {
    for (const attribute of tag.attributes.filter(isAllowlisted)) {
      if (!take(attributesBefore, keyed(tag, attribute)))
        added.push([tag, attribute]);
    }
  }
  const removed = [...attributesBefore]
    .filter(([, left]) => left > 0)
    .map(([key]) => key.slice(key.indexOf("|") + 1));
  // A rewritten class attribute shows up as one removed and one added. Only tokens the rewrite
  // brought in count as new, so editing an element that was already hidden is not blamed.
  const replacedClasses = count(
    removed.flatMap((key) =>
      key.startsWith("class=") ? key.slice(6).split(/\s+/) : [],
    ),
    (token) => token,
  );
  const context: Context = { replacedClasses, known, existingIds, verdict };
  for (const [tag, attribute] of added)
    checkNewAttribute(tag, attribute, context);

  const addedNames = new Set(
    added.map(([, attribute]) => baseName(attribute.name)),
  );
  for (const key of removed) {
    const name = baseName(key.split("=")[0] ?? key);
    if (name === "role")
      verdict.problems.push(
        `removes or changes ${key}. Keep the role and supply what it needs`,
      );
    else if (WATCHED_REMOVALS.test(name) && !addedNames.has(name))
      verdict.review.push(`removes ${key.slice(0, 60)}`);
    else if (/^aria-(?!hidden|label|describedby)/.test(name))
      verdict.review.push(`removes or changes ${key.slice(0, 60)}`);
  }

  const textsBefore = count(was.texts, (text) => text);
  for (const text of now.texts) {
    if (take(textsBefore, text)) continue;
    const expressions = [...text.matchAll(/\{\{([\s\S]*?)\}\}/g)].map(
      (match) => match[1] ?? "",
    );
    for (const expression of expressions) {
      const problem = expressionProblem(expression, known);
      if (problem !== undefined)
        verdict.problems.push(
          `adds {{ ${expression.trim().slice(0, 60)} }}, which ${problem}`,
        );
    }
    const literal = text.replace(/\{\{[\s\S]*?\}\}/g, "").trim();
    if (
      /[{}]/.test(literal) ||
      URL_LIKE.test(literal) ||
      literal.length > MAX_VALUE_LENGTH
    ) {
      verdict.problems.push(
        "adds text that is too long, contains a URL or contains template syntax",
      );
    } else if (literal !== "" || expressions.length > 0) {
      verdict.review.push(
        `${HONESTY.draft} New text: ${JSON.stringify(text.slice(0, 80))}.`,
      );
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
      verdict.problems.push(
        "only Vue component templates can be changed automatically",
      );
    } else {
      const before = splitSfc(change.before);
      const after = splitSfc(change.after);
      if (!before.ok) verdict.problems.push(before.reason);
      else if (!after.ok) verdict.problems.push(after.reason);
      else if (before.outside !== after.outside) {
        verdict.problems.push(
          "changes code outside <template>. Script and style changes need a person",
        );
      } else {
        checkTemplate(before.template, after.template, verdict);
      }
    }
    problems.push(
      ...verdict.problems.map((message) => `${change.path}: ${message}`),
    );
    review.push(
      ...verdict.review.map((message) => `${change.path}: ${message}`),
    );
  }

  if (problems.length > 0)
    return {
      gate: "safety",
      passed: false,
      detail: [...new Set(problems)].sort().join("\n"),
    };
  if (review.length > 0)
    return {
      gate: "safety",
      passed: true,
      flagged: true,
      detail: [...new Set(review)].sort().join("\n"),
    };
  return {
    gate: "safety",
    passed: true,
    detail: "template-only change with no new code paths",
  };
}
