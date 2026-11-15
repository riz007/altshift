import { z } from "zod";

const optionalNumber = (check: z.ZodNumber) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? undefined : Number(value)))
    .pipe(check.optional());

export const inputsSchema = z.object({
  mode: z.enum(["debt", "pr"]).default("debt"),
  config: z.string().trim().min(1).default("ariamend.config.ts"),
  anthropicApiKey: z.string().trim().min(1, "anthropic-api-key is required"),
  githubToken: z.string().trim().min(1, "github-token is required"),
  maxFixes: optionalNumber(z.number().int().positive().max(50)),
  budgetUsd: optionalNumber(z.number().positive().max(100)),
});
export type Inputs = z.infer<typeof inputsSchema>;

/** The environment variable action.yml sets for an input: INPUT_ANTHROPIC_API_KEY for anthropic-api-key. */
export function inputVariable(name: string): string {
  return `INPUT_${name.replace(/[- ]/g, "_").toUpperCase()}`;
}

/**
 * Read one input. action.yml passes inputs with underscores in their names, never hyphens: the
 * ariamend command is often started through a /bin/sh launcher (pnpm, yarn), and on Ubuntu /bin/sh
 * is dash, which silently drops environment variables whose names are not valid shell names.
 * @actions/core's getInput expects the hyphenated name, so it is not used.
 */
export function readInput(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return (env[inputVariable(name)] ?? "").trim();
}

/** Read and validate the Action's inputs. `get` returns "" for an input that was not set. */
export function parseInputs(get: (name: string) => string): z.ZodSafeParseResult<Inputs> {
  const value = (name: string) => get(name) || undefined;
  return inputsSchema.safeParse({
    mode: value("mode"),
    config: value("config"),
    anthropicApiKey: get("anthropic-api-key"),
    githubToken: get("github-token"),
    maxFixes: get("max-fixes"),
    budgetUsd: get("budget-usd"),
  });
}

// The Action holds write access and an API key, and runs the project's code, so it only runs on code
// already on the default branch. Pull request, comment and pull_request_target events are refused.
const SAFE_EVENTS = new Set(["schedule", "workflow_dispatch", "push"]);

export function isSafeEvent(event: string): boolean {
  return SAFE_EVENTS.has(event);
}
