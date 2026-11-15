#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { ExitCode } from "@ariamend/core";
import { main } from "./run.js";

// Local runs keep the API key in .env.local. Only that one name is taken from the file, and never in CI:
// the working directory is the project being fixed, and its files must not be able to point the
// client at another host or change how this process runs.
if (!process.env.CI && !process.env.ANTHROPIC_API_KEY) {
  try {
    const key = parseEnv(readFileSync(".env.local", "utf8")).ANTHROPIC_API_KEY;
    if (key) process.env.ANTHROPIC_API_KEY = key;
  } catch {
    // No file. The command says so if it needs the key.
  }
}

main(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`ariamend: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = ExitCode.Failure;
  },
);
