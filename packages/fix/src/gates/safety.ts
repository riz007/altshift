import { HONESTY } from "@ariamend/core";
import type { FileChange } from "../diff.js";
import type { GateResult } from "../types.js";
import {
  NodeType,
  type SfcParse,
  type VueAttribute,
  type VueDirective,
  type VueElement,
  type VueNode,
} from "./vue-sfc.js";

// The checks, rescan and build gates run the project's code, so an edit must not be able to add code,
// load something external, or hide or remove what the finding is about. Searching the diff for
// dangerous strings cannot decide that. This gate works the other way round:
//
// - Only the <template> of a Vue component may change, read by the project's own Vue compiler.
// - The old template must still be there, node for node and in order, once the additions are taken out.
// - Every addition must be on a short list of things an accessibility fix needs.

const ALLOWLISTED = /^(?:aria-[a-z]+|alt|title|lang|role|id|for|type|tabindex|class|name|autocomplete|scope)$/;
// Script, CSS and labels hook into these. Once an element has one, a fix may not change or remove it.
const FIXED_ONCE_SET = /^(?:type|name|for|id|role)$/;

const ADDABLE_TAGS = new Set(
  "span label li ul ol dl dt dd p div strong em abbr legend fieldset caption h1 h2 h3 h4 h5 h6".split(" "),
);
const SVG_ADDABLE_TAGS = new Set(["title", "desc"]);
const isComponent = (name: string) => /[A-Z-]/.test(name);

const STATE_ATTRIBUTES = /^aria-(?:checked|expanded|pressed|selected)$/;
const NAME_ATTRIBUTES = /^(?:aria-label|alt|title|aria-description|aria-valuetext|aria-placeholder)$/;
const REFERENCE_ATTRIBUTES = /^aria-(?:labelledby|describedby)$/;
// On these elements a name is ignored or not allowed unless a role says otherwise.
const NO_NAME_WITHOUT_ROLE = /^(?:div|span|p|label|legend|caption|strong|em|abbr|li|dt|dd)$/;
const WATCHED_REMOVALS = /^(?:aria-label|aria-labelledby|aria-describedby|alt|autocomplete|lang)$/;
// Assistive technology ignores everything inside an element with one of these roles.
const CHILDREN_PRESENTATIONAL =
  /^(?:button|checkbox|img|math|menuitemcheckbox|menuitemradio|meter|option|progressbar|radio|scrollbar|separator|slider|switch|tab)$/;
const HIDING_CLASS = /(?:^|:)(?:hidden|invisible|d-none|opacity-0|collapse)$/;
const URL_LIKE = /[a-z][a-z0-9+.-]*:\/\/|(?:^|[\s"'(])\/\/[\w-]+\./i;
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
const SIMPLE_EXPRESSION = new RegExp(`^(?:${PATH}|${VALUE}|${PATH}\\s*\\?\\s*${VALUE}\\s*:\\s*${VALUE})$`);
const CONSTANTS = new Set(["true", "false", "null", "undefined"]);
const FORBIDDEN_IDENTIFIER =
  /(?<![\w$])(?:process|globalThis|window|document|self|global|constructor|__proto__|prototype|eval|Function|import|require|useRuntimeConfig)(?![\w$])/;

/** The parts of an expression that are code: quoted text is dropped, template placeholders are kept. */
function codeOf(expression: string): string {
  return expression
    .replace(/`[^`]*`/g, (template) => [...template.matchAll(/\$\{([^}]*)\}/g)].map((match) => match[1]).join(" "))
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
  return [...codeOf(expression).matchAll(/(?<![\w$.])[A-Za-z_$][\w$]*/g)].map((match) => match[0]);
}

/**
 * Why an expression may not be added, or undefined when it is fine.
 * It must match the small grammar, and may only read names the template already uses: a fix has no
 * reason to surface data the component never showed, such as route parameters or runtime config.
 */
function expressionProblem(expression: string, known: ReadonlySet<string>): string | undefined {
  const trimmed = expression.trim();
  if (trimmed.includes("&")) return "contains an HTML entity";
  if (!SIMPLE_EXPRESSION.test(trimmed) || FORBIDDEN_IDENTIFIER.test(codeOf(trimmed))) {
    return "may only read a value, pick between two strings, or call $t()";
  }
  for (const root of rootsOf(trimmed)) {
    if (CONSTANTS.has(root) || root === "$t" || root === "$props") continue;
    if (/^[$_]/.test(root)) return `reads ${root}, a framework internal`;
    if (!known.has(root)) return `reads "${root}", which this template does not already use`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Reading the Vue AST

interface Attr {
  name: string;
  bound: boolean;
  value: string | null;
}

const isElement = (node: VueNode): node is VueElement => node.type === NodeType.Element;
const textOf = (node: VueNode) => ("content" in node && typeof node.content === "string" ? node.content : "");
const expressionOf = (node: VueNode) =>
  "content" in node && typeof node.content === "object" && node.content !== null ? node.content.content : "";
const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Children without whitespace-only text, which Vue drops or collapses anyway. */
function meaningful(children: readonly VueNode[]): VueNode[] {
  return children.filter((child) => child.type !== NodeType.Text || collapse(textOf(child)) !== "");
}

/** Bound attributes with a static name, such as :aria-label, count as attributes. Everything else is behaviour. */
function asAttribute(prop: VueAttribute | VueDirective): Attr | undefined {
  if (prop.type === NodeType.Attribute) {
    return ALLOWLISTED.test(prop.name)
      ? { name: prop.name, bound: false, value: prop.value?.content ?? null }
      : undefined;
  }
  const modifiers = prop.modifiers.length > 0;
  if (prop.name !== "bind" || !prop.arg?.isStatic || modifiers || !ALLOWLISTED.test(prop.arg.content)) return undefined;
  return { name: prop.arg.content, bound: true, value: prop.exp?.content ?? "" };
}

function attributesOf(element: VueElement): Attr[] {
  return element.props.map(asAttribute).filter((attr): attr is Attr => attr !== undefined);
}

/** Handlers, directives and every attribute outside the allowlist, in a stable form. A fix must leave these alone. */
function behaviour(element: VueElement): string {
  return element.props
    .filter((prop) => asAttribute(prop) === undefined)
    .map((prop) => {
      if (prop.type === NodeType.Attribute) return `${prop.name}=${prop.value?.content ?? ""}`;
      const modifiers = prop.modifiers.map((modifier) => (typeof modifier === "string" ? modifier : modifier.content));
      return `v-${prop.name}:${prop.arg?.content ?? ""}${prop.arg && !prop.arg.isStatic ? "(dynamic)" : ""}.${modifiers.join(".")}=${prop.exp?.content ?? ""}`;
    })
    .sort()
    .join("  ");
}

const key = (attr: Attr) => `${attr.bound ? ":" : ""}${attr.name}`;
const shown = (attr: Attr) => (attr.value === null ? key(attr) : `${key(attr)}="${attr.value.slice(0, 60)}"`);

// ---------------------------------------------------------------------------------------------
// Checks

interface Verdict {
  problems: string[];
  review: string[];
}

interface Context {
  /** Names that expressions in the old template already read. */
  known: ReadonlySet<string>;
  existingIds: ReadonlySet<string>;
}

function checkNewAttribute(element: VueElement, attr: Attr, context: Context, verdict: Verdict): void {
  const { name, bound } = attr;
  const value = attr.value ?? "";

  if (bound) {
    const problem = expressionProblem(value, context.known);
    if (problem !== undefined) {
      verdict.problems.push(`adds ${shown(attr)}, which ${problem}`);
      return;
    }
  }
  if (value.length > MAX_VALUE_LENGTH || URL_LIKE.test(value)) {
    verdict.problems.push(`adds ${shown(attr)}, which is too long or contains a URL`);
    return;
  }

  // Fixed text is checked the same way whether it is written plainly or inside a binding.
  const literals = bound ? literalsOf(value) : [value];
  const readsState = bound && rootsOf(value).some((root) => !CONSTANTS.has(root) && root !== "$t" && root !== "t");
  const has = (pattern: RegExp) => attributesOf(element).some((other) => pattern.test(other.name));
  const tag = element.tag;
  const interactive = /^(?:a|button|input|select|textarea|summary)$/i.test(tag) || isComponent(tag);
  const hasElementChildren = element.children.some(isElement);

  if (name === "aria-hidden") {
    if (!/^(?:svg|i)$/.test(tag))
      verdict.problems.push(`adds aria-hidden to <${tag}>. Fix the element instead of hiding it`);
    else verdict.review.push("adds aria-hidden to an icon");
  }
  if (name === "aria-roledescription")
    verdict.problems.push("adds aria-roledescription, which replaces the role users hear");
  if (name === "aria-owns")
    verdict.problems.push("adds aria-owns, which moves other elements in the accessibility tree");
  if (
    name === "class" &&
    literals.flatMap((literal) => literal.split(/\s+/)).some((token) => HIDING_CLASS.test(token))
  ) {
    verdict.problems.push(`adds a class that hides the element (${shown(attr)})`);
  }
  if (name === "role") {
    if (literals.some((literal) => /^(?:presentation|none)$/.test(literal))) {
      if (/^(?:img|svg)$/.test(tag)) verdict.review.push("gives an image a presentation role");
      else verdict.problems.push(`gives <${tag}> a presentation role, which removes its meaning`);
    }
    const presentational = literals.find((literal) => CHILDREN_PRESENTATIONAL.test(literal));
    if (presentational && hasElementChildren && tag !== "svg") {
      verdict.problems.push(
        `gives <${tag}> role="${presentational}", which hides everything inside it from assistive technology`,
      );
    }
  }
  if (name === "type" && !(tag === "button" && !bound && value === "button")) {
    verdict.problems.push(`adds ${shown(attr)}. Only type="button" on a button that has no type can be added`);
  }
  if (name === "name") verdict.problems.push(`adds ${shown(attr)}, which changes what a form submits`);
  if (STATE_ATTRIBUTES.test(name) && !readsState) {
    verdict.problems.push(
      `adds a fixed ${shown(attr)}. Bind it to the component's state so it changes when the control does`,
    );
  }
  if (/^aria-label(?:ledby)?$/.test(name) && NO_NAME_WITHOUT_ROLE.test(tag) && !has(/^role$/)) {
    verdict.problems.push(`adds ${name} to a <${tag}> with no role, where assistive technology ignores it`);
  }
  if (name === "aria-label" && value.includes("?") && has(/^aria-pressed$/)) {
    verdict.problems.push("makes the name change with state on a toggle that has aria-pressed. Keep one name");
  }
  if (name === "tabindex") {
    if (literals.some((literal) => /^\s*-/.test(literal))) verdict.review.push('adds tabindex="-1"');
    else if (!interactive && !has(/^role$/)) verdict.problems.push(`adds ${shown(attr)} to a <${tag}> with no role`);
  }
  if (name === "id" && !bound) {
    if (context.existingIds.has(value))
      verdict.problems.push(`adds id "${value}", which is already used in this template`);
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
  const empty = attr.value === null || (literals.length === 1 && literals[0] === "" && !readsState);
  if (name === "alt" && empty) {
    verdict.review.push('adds an empty alt="", which tells assistive technology to skip the image');
    return;
  }
  if (value === "") return;
  // Any new name is the model's choice, whether it wrote the words or picked the field to bind.
  const how =
    !bound || literals.length > 0
      ? `New ${name}: ${JSON.stringify(value.slice(0, 80))}.`
      : `${name} is bound to ${value}: check this field describes this control.`;
  const translated = /\$?t\(/.test(codeOf(value)) ? " The translation key was not checked." : "";
  const unseen = name === "alt" || /^(?:svg|img)$/.test(tag) ? " The image itself was not viewed." : "";
  verdict.review.push(`${HONESTY.draft} ${how}${translated}${unseen}`);
}

function checkNewText(text: string, verdict: Verdict): void {
  const literal = collapse(text);
  if (/[{}]/.test(literal) || URL_LIKE.test(literal) || literal.length > MAX_VALUE_LENGTH) {
    verdict.problems.push("adds text that is too long, contains a URL or contains template syntax");
  } else if (literal !== "") {
    verdict.review.push(`${HONESTY.draft} New text: ${JSON.stringify(literal.slice(0, 80))}.`);
  }
}

/** A node that is not in the old template. Only plain markup an accessibility fix needs may be added. */
function checkInserted(node: VueNode, parent: VueElement | undefined, context: Context, verdict: Verdict): void {
  if (node.type === NodeType.Text) {
    checkNewText(textOf(node), verdict);
    return;
  }
  if (node.type === NodeType.Interpolation) {
    const expression = expressionOf(node);
    const problem = expressionProblem(expression, context.known);
    if (problem !== undefined) verdict.problems.push(`adds {{ ${expression.trim().slice(0, 60)} }}, which ${problem}`);
    else verdict.review.push(`${HONESTY.draft} New text from {{ ${expression.trim().slice(0, 60)} }}.`);
    return;
  }
  if (node.type === NodeType.Comment) {
    verdict.problems.push("adds a comment. A fix never needs one");
    return;
  }
  if (!isElement(node)) {
    verdict.problems.push("adds something Vue does not read as markup, text or an expression");
    return;
  }

  const inSvg = parent?.tag === "svg" || (parent?.ns ?? 0) !== 0;
  if (!(ADDABLE_TAGS.has(node.tag) || (inSvg && SVG_ADDABLE_TAGS.has(node.tag)))) {
    verdict.problems.push(`adds a <${node.tag}> element`);
    return;
  }
  const extra = behaviour(node);
  if (extra !== "") {
    verdict.problems.push(`adds a <${node.tag}> with a handler, directive or other attribute (${extra.slice(0, 80)})`);
    return;
  }
  for (const attr of attributesOf(node)) checkNewAttribute(node, attr, context, verdict);
  for (const child of meaningful(node.children)) checkInserted(child, node, context, verdict);
}

// A fix may turn a row into a list item, or visible text into the label for a control.
function renameAllowed(from: string, to: string, parent: VueElement | undefined): boolean {
  if (to === "li") return /^(?:div|span|p)$/.test(from) && /^(?:ul|ol|menu)$/.test(parent?.tag ?? "");
  if (to === "label") return /^(?:span|div|p|strong)$/.test(from);
  return false;
}

/** Could `now` be the same node as `old`? Same kind, same element and the same behaviour. */
function sameHead(old: VueNode, now: VueNode, parent: VueElement | undefined): boolean {
  if (old.type !== now.type) return false;
  if (isElement(old) && isElement(now)) {
    const tagOk = old.tag === now.tag || renameAllowed(old.tag, now.tag, parent);
    return tagOk && old.ns === now.ns && behaviour(old) === behaviour(now);
  }
  if (old.type === NodeType.Interpolation) return expressionOf(old) === expressionOf(now);
  return collapse(textOf(old)) === collapse(textOf(now));
}

function compareElements(old: VueElement, now: VueElement, context: Context, verdict: Verdict): void {
  if (old.tag !== now.tag) verdict.review.push(`changes a <${old.tag}> into a <${now.tag}>`);

  const before = new Map(attributesOf(old).map((attr) => [key(attr), attr]));
  const after = new Map(attributesOf(now).map((attr) => [key(attr), attr]));
  for (const [name, attr] of after) {
    const was = before.get(name);
    if (was === undefined) {
      checkNewAttribute(now, attr, context, verdict);
      continue;
    }
    if (was.value === attr.value) continue;
    if (FIXED_ONCE_SET.test(attr.name)) {
      verdict.problems.push(`changes ${shown(was)} to ${shown(attr)} on <${now.tag}>`);
    } else if (attr.name === "class" && !attr.bound) {
      const had = new Set((was.value ?? "").split(/\s+/).filter(Boolean));
      const has = new Set((attr.value ?? "").split(/\s+/).filter(Boolean));
      const added = [...has].filter((token) => !had.has(token));
      const removed = [...had].filter((token) => !has.has(token));
      if (added.some((token) => HIDING_CLASS.test(token)))
        verdict.problems.push(`adds a class that hides <${now.tag}> (${added.join(" ")})`);
      if (removed.length > 0) verdict.review.push(`removes class ${removed.join(" ")} from <${now.tag}>`);
    } else {
      checkNewAttribute(now, attr, context, verdict);
      verdict.review.push(`changes ${shown(was)} on <${now.tag}>`);
    }
  }
  for (const [name, attr] of before) {
    if (after.has(name)) continue;
    if (FIXED_ONCE_SET.test(attr.name)) verdict.problems.push(`removes ${shown(attr)} from <${now.tag}>`);
    else if (WATCHED_REMOVALS.test(attr.name) || attr.name.startsWith("aria-") || attr.name === "class") {
      verdict.review.push(`removes ${shown(attr)} from <${now.tag}>`);
    }
  }

  alignChildren(old.children, now.children, now, context, verdict);
}

function compareNodes(old: VueNode, now: VueNode, context: Context, verdict: Verdict): void {
  if (isElement(old) && isElement(now)) compareElements(old, now, context, verdict);
}

function describe(node: VueNode): string {
  if (isElement(node)) return `<${node.tag}>`;
  if (node.type === NodeType.Interpolation) return `{{ ${expressionOf(node).trim().slice(0, 40)} }}`;
  if (node.type === NodeType.Comment) return "a comment";
  return `the text ${JSON.stringify(collapse(textOf(node)).slice(0, 40))}`;
}

/**
 * Every old child must still be there, in the same order, with only additions in between.
 * Moving, swapping, removing or rewriting a node fails, so nothing can be re-nested inside a v-if,
 * have its handler swapped with a neighbour's, or be hidden by trading classes with another element.
 */
function alignChildren(
  oldChildren: readonly VueNode[],
  newChildren: readonly VueNode[],
  parent: VueElement | undefined,
  context: Context,
  verdict: Verdict,
): void {
  const old = meaningful(oldChildren);
  const now = meaningful(newChildren);
  let next = 0;

  for (const node of old) {
    const candidates: number[] = [];
    for (let index = next; index < now.length; index++) {
      const candidate = now[index] as VueNode;
      if (sameHead(node, candidate, parent)) candidates.push(index);
    }
    if (candidates.length === 0) {
      verdict.problems.push(`removes, moves or rewrites ${describe(node)}. Fix it in place instead`);
      continue;
    }
    // Prefer the candidate the old node matches exactly, so an inserted sibling of the same kind
    // is not mistaken for the old one.
    const exact = candidates.find((index) => {
      const trial: Verdict = { problems: [], review: [] };
      compareNodes(node, now[index] as VueNode, context, trial);
      return trial.problems.length === 0;
    });
    const match = exact ?? (candidates[0] as number);
    for (let index = next; index < match; index++) checkInserted(now[index] as VueNode, parent, context, verdict);
    compareNodes(node, now[match] as VueNode, context, verdict);
    next = match + 1;
  }
  for (let index = next; index < now.length; index++) checkInserted(now[index] as VueNode, parent, context, verdict);
}

function collectContext(children: readonly VueNode[]): Context {
  const expressions: string[] = [];
  const ids: string[] = [];
  const visit = (node: VueNode) => {
    if (node.type === NodeType.Interpolation) expressions.push(expressionOf(node));
    if (!isElement(node)) return;
    for (const prop of node.props) {
      if (prop.type === NodeType.Directive && prop.exp) expressions.push(prop.exp.content);
      if (prop.type === NodeType.Attribute && prop.name === "id" && prop.value) ids.push(prop.value.content);
    }
    node.children.forEach(visit);
  };
  children.forEach(visit);
  return {
    known: new Set(expressions.flatMap((code) => codeOf(code).match(/[A-Za-z_$][\w$]*/g) ?? [])),
    existingIds: new Set(ids),
  };
}

// ---------------------------------------------------------------------------------------------
// The file

function errorsOf(result: ReturnType<SfcParse>): string[] {
  return result.errors.map((error) => (typeof error === "string" ? error : error.message));
}

function checkFile(change: FileChange, parse: SfcParse, verdict: Verdict): void {
  if (!change.path.endsWith(".vue")) {
    verdict.problems.push("only Vue component templates can be changed automatically");
    return;
  }

  let before: ReturnType<SfcParse>;
  let after: ReturnType<SfcParse>;
  try {
    before = parse(change.before);
    after = parse(change.after);
  } catch {
    verdict.problems.push("Vue could not parse the file");
    return;
  }
  if (errorsOf(before).length > 0) {
    verdict.problems.push(`Vue already reports a problem in this file (${errorsOf(before)[0]}). It needs a person`);
    return;
  }
  if (errorsOf(after).length > 0) {
    verdict.problems.push(`the change makes Vue report a problem: ${errorsOf(after)[0]}`);
    return;
  }

  const was = before.descriptor.template;
  const now = after.descriptor.template;
  if (!was?.ast || !now?.ast) {
    verdict.problems.push("has no <template> block");
    return;
  }
  if (now.src !== undefined || (now.lang !== undefined && now.lang !== "html")) {
    verdict.problems.push("the template is loaded from another file or written in another language");
    return;
  }
  // Everything outside the template, including the <template> tag itself, must be byte for byte the same.
  const outside = (source: string, block: typeof was) =>
    source.slice(0, block.loc.start.offset) + source.slice(block.loc.end.offset);
  if (outside(change.before, was) !== outside(change.after, now)) {
    verdict.problems.push("changes code outside <template>. Script and style changes need a person");
    return;
  }
  // Custom delimiters would make expressions the gate cannot see.
  const script = `${after.descriptor.script?.content ?? ""}\n${after.descriptor.scriptSetup?.content ?? ""}`;
  if (/\bdelimiters\b/.test(script)) {
    verdict.problems.push("the component sets custom template delimiters, which this gate does not read");
    return;
  }

  alignChildren(was.ast.children, now.ast.children, undefined, collectContext(was.ast.children), verdict);
}

/**
 * Allow only template changes that an accessibility fix needs, and nothing that can run code,
 * load something external, or hide, move or remove what is already there.
 * `parse` must be the project's own `vue/compiler-sfc` parse, so the gate reads what Vue will compile.
 */
export function safetyGate(changes: readonly FileChange[], parse: SfcParse): GateResult {
  const problems: string[] = [];
  const review: string[] = [];

  for (const change of changes) {
    const verdict: Verdict = { problems: [], review: [] };
    checkFile(change, parse, verdict);
    problems.push(...verdict.problems.map((message) => `${change.path}: ${message}`));
    review.push(...verdict.review.map((message) => `${change.path}: ${message}`));
  }

  if (problems.length > 0) return { gate: "safety", passed: false, detail: [...new Set(problems)].sort().join("\n") };
  if (review.length > 0)
    return { gate: "safety", passed: true, flagged: true, detail: [...new Set(review)].sort().join("\n") };
  return { gate: "safety", passed: true, detail: "template-only change with no new code paths" };
}
