import { access, glob } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { configSchema, type ResolvedConfig } from "./config.js";
import type { Journey } from "./journey.js";
import { errorMessage, fail, ok, type Result } from "./result.js";

const CONFIG_NAMES = ["altshift.config.ts", "altshift.config.mts", "altshift.config.mjs", "altshift.config.js"];

const journeySchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]*$/i, "Journey names use letters, digits and dashes"),
  run: z.custom<Journey["run"]>((value) => typeof value === "function", "run must be a function"),
});

export interface LoadedConfig {
  config: ResolvedConfig;
  path: string;
  /** Journey globs and app commands resolve from here. */
  root: string;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

// TypeScript files load through Node's built-in type stripping, so there is no loader dependency.
async function importDefault(path: string): Promise<unknown> {
  try {
    const module: { default?: unknown } = await import(pathToFileURL(path).href);
    return module.default;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_UNKNOWN_FILE_EXTENSION") {
      throw new Error("Loading TypeScript files needs Node 22.18 or newer. Upgrade Node, or use a .mjs file.");
    }
    throw error;
  }
}

export async function loadConfig(cwd: string, explicitPath?: string): Promise<Result<LoadedConfig>> {
  let path: string | undefined;
  if (explicitPath !== undefined) {
    path = isAbsolute(explicitPath) ? explicitPath : resolve(cwd, explicitPath);
    if (!(await exists(path))) return fail("config-not-found", `Config file not found: ${path}`);
  } else {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(cwd, name);
      if (await exists(candidate)) {
        path = candidate;
        break;
      }
    }
    if (path === undefined) {
      return fail("config-not-found", `No altshift.config.ts in ${cwd}. Pass --config, or create one.`);
    }
  }

  let raw: unknown;
  try {
    raw = await importDefault(path);
  } catch (error) {
    return fail("config-invalid", `Could not load ${path}: ${errorMessage(error)}`);
  }
  if (raw === undefined) return fail("config-invalid", `${path} has no default export.`);

  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) return fail("config-invalid", `Invalid config in ${path}:\n${z.prettifyError(parsed.error)}`);
  return ok({ config: parsed.data, path, root: dirname(path) });
}

export async function loadJourneys(root: string, pattern: string | undefined): Promise<Result<Journey[]>> {
  if (pattern === undefined) return ok([]);

  const files: string[] = [];
  for await (const file of glob(pattern, { cwd: root })) files.push(resolve(root, file));
  files.sort();

  const journeys: Journey[] = [];
  const seen = new Map<string, string>();
  for (const file of files) {
    let raw: unknown;
    try {
      raw = await importDefault(file);
    } catch (error) {
      return fail("journey-invalid", `Could not load ${file}: ${errorMessage(error)}`);
    }
    const parsed = journeySchema.safeParse(raw);
    if (!parsed.success) {
      return fail("journey-invalid", `Invalid journey in ${file}:\n${z.prettifyError(parsed.error)}`);
    }
    const previous = seen.get(parsed.data.name);
    if (previous !== undefined) {
      return fail("journey-invalid", `Journey name "${parsed.data.name}" is used by both ${previous} and ${file}.`);
    }
    seen.set(parsed.data.name, file);
    journeys.push(parsed.data);
  }
  return ok(journeys);
}
