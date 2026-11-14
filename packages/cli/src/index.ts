#!/usr/bin/env node
import { ExitCode } from "altshift";
import { main } from "./run.js";

main(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`altshift: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    process.exitCode = ExitCode.Failure;
  },
);
