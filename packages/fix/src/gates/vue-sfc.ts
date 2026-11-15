import { createRequire } from "node:module";
import { join } from "node:path";

// The safety gate parses templates with the project's own Vue compiler. A separate parser, however
// careful, reads some inputs differently from Vue (short comments, <title> content, CDATA), and
// each difference is a place to hide an expression. Using the same parser leaves nothing to differ.
// Only the fields the gate reads are typed here.

export const NodeType = {
  Root: 0,
  Element: 1,
  Text: 2,
  Comment: 3,
  Interpolation: 5,
  Attribute: 6,
  Directive: 7,
} as const;

export interface VueAttribute {
  type: 6;
  name: string;
  value?: { content: string };
}

export interface VueDirective {
  type: 7;
  name: string;
  rawName?: string;
  exp?: { content: string };
  arg?: { content: string; isStatic: boolean };
  modifiers: Array<string | { content: string }>;
}

export interface VueElement {
  type: 1;
  tag: string;
  ns: number;
  props: Array<VueAttribute | VueDirective>;
  children: VueNode[];
}

export type VueNode =
  | VueElement
  | { type: 2; content: string }
  | { type: 3; content: string }
  | { type: 5; content: { content: string } }
  | { type: number };

interface SfcBlock {
  content: string;
  loc: { start: { offset: number }; end: { offset: number } };
  src?: string;
  lang?: string;
}

export interface SfcParseResult {
  descriptor: {
    template: (SfcBlock & { ast?: { children: VueNode[] } }) | null;
    script: SfcBlock | null;
    scriptSetup: SfcBlock | null;
  };
  errors: Array<{ message: string } | string>;
}

export type SfcParse = (source: string) => SfcParseResult;

/** The project's `vue/compiler-sfc`, or undefined when the project does not have Vue installed. */
export function loadSfcParser(projectRoot: string): SfcParse | undefined {
  try {
    const require = createRequire(join(projectRoot, "package.json"));
    const compiler: { parse?: unknown } = require("vue/compiler-sfc");
    if (typeof compiler.parse !== "function") return undefined;
    const parse = compiler.parse as (source: string, options: object) => SfcParseResult;
    return (source) => parse(source, { sourceMap: false });
  } catch {
    return undefined;
  }
}
