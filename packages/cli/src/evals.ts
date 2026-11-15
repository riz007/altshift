import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  anthropicClient,
  type CaseResult,
  type EvalCase,
  evalCaseSchema,
  type FixRunReport,
  runFix,
  scoreCase,
  summarize,
} from "@altshift/fix";
import { ExitCode, matchesGlob, printable } from "altshift";
import type { Io } from "./run.js";

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(0)}%`);
const dollars = (value: number | null) => (value === null ? "n/a" : `$${value.toFixed(4)}`);

/** Run the fix engine on each fixture that has cases, score the cases, and save the result. Internal. */
export async function runEvals(io: Io, only: string | undefined): Promise<ExitCode> {
  if (!process.env.ANTHROPIC_API_KEY) {
    io.stderr("altshift eval: ANTHROPIC_API_KEY is not set. Put it in .env.local or export it.\n");
    return ExitCode.Failure;
  }

  const caseDir = join(io.cwd, "evals", "cases");
  let names: string[];
  try {
    names = (await readdir(caseDir)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    io.stderr(`altshift eval: no evals/cases folder in ${io.cwd}. Run it from the AltShift repo root.\n`);
    return ExitCode.Failure;
  }

  const cases: EvalCase[] = [];
  for (const name of names) {
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(caseDir, name), "utf8"));
    } catch {
      io.stderr(`altshift eval: ${name} is not valid JSON.\n`);
      return ExitCode.Failure;
    }
    const parsed = evalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      io.stderr(`altshift eval: ${name} is not a valid case: ${parsed.error.message}\n`);
      return ExitCode.Failure;
    }
    if (only === undefined || matchesGlob(parsed.data.id, only)) cases.push(parsed.data);
  }
  if (cases.length === 0) {
    io.stderr("altshift eval: no cases matched.\n");
    return ExitCode.Failure;
  }

  const client = await anthropicClient();
  const reports: FixRunReport[] = [];
  const results: CaseResult[] = [];
  for (const fixture of [...new Set(cases.map((item) => item.fixture))].sort()) {
    io.stderr(`Fixture ${fixture}\n`);
    const run = await runFix({
      cwd: join(io.cwd, "fixtures", fixture),
      dryRun: true,
      client,
      log: (line) => io.stderr(`  ${printable(line)}\n`),
    });
    if (!run.ok) {
      io.stderr(`altshift eval: ${fixture}: ${run.error.message}\n`);
      return ExitCode.Failure;
    }
    reports.push(run.value);
    for (const item of cases.filter((candidate) => candidate.fixture === fixture))
      results.push(scoreCase(item, run.value));
  }

  const summary = summarize(cases, results, reports);
  const models = [...new Set(reports.flatMap((report) => report.models))].sort();
  const date = new Date().toISOString().slice(0, 10);
  const file = join("evals", "results", `${date}-${models[0] ?? "no-model"}.json`);
  await mkdir(join(io.cwd, "evals", "results"), { recursive: true });
  const record = { date, models, promptVersion: reports[0]?.promptVersion, filter: only ?? null, summary, results };
  await writeFile(join(io.cwd, file), `${JSON.stringify(record, null, 2)}\n`);

  const lines = results.map((result) => {
    const state = result.passed ? "pass" : "FAIL";
    const why = result.reasons.length > 0 ? `  ${printable(result.reasons.join("; "))}` : "";
    return `${state}  ${result.id.padEnd(34)} ${result.status.padEnd(13)} ${result.attempts} attempt(s)  ${dollars(result.costUsd)}${why}`;
  });
  io.stdout(
    [
      ...lines,
      "",
      `${summary.passed} of ${summary.cases} cases passed`,
      `Fix rate ${percent(summary.fixRate)}, regression rate ${percent(summary.regressionRate)}, refusals ${summary.refusals}, fallbacks ${summary.fallbacks}`,
      `Cost ${dollars(summary.costUsd)}, per accepted fix ${dollars(summary.costPerAcceptedFixUsd)}`,
      `Saved ${file}`,
      "",
    ].join("\n"),
  );
  return ExitCode.Completed;
}
