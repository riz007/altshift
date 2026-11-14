import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const STOP_GRACE_MS = 5000;
const OUTPUT_TAIL_LINES = 40;

// The customer's commands run code the model may have edited. They never need our keys,
// and they must not be able to write to the files GitHub Actions reads back into later steps.
const WITHHELD_ENV =
  /^(ANTHROPIC_|CLAUDE_|ALTSHIFT_|INPUT_|AWS_BEARER_TOKEN_BEDROCK$|(GITHUB|GH)(_ENTERPRISE)?_TOKEN$|ACTIONS_ID_TOKEN|ACTIONS_RUNTIME_TOKEN|GITHUB_(ENV|PATH|OUTPUT|STATE|STEP_SUMMARY)$)/i;

// Stays in the child's environment, because the project may need it, but never appears in what we keep of the output.
const SENSITIVE_NAME = /TOKEN|SECRET|KEY|PASSWORD|PASSWD|CREDENTIAL|AUTH|DSN/i;

const SECRET_SHAPES = [
  /sk-ant-[\w-]{8,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_\w{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /(?<=:\/\/)[^\s/:@]+:[^\s/@]+(?=@)/g,
];

export function scrubbedEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !WITHHELD_ENV.test(name)));
}

/** Remove secret values, and anything shaped like a well-known token, from command output. */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = text;
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && (WITHHELD_ENV.test(name) || SENSITIVE_NAME.test(name))) {
      redacted = redacted.replaceAll(value, "[redacted]");
    }
  }
  for (const shape of SECRET_SHAPES) redacted = redacted.replace(shape, "[redacted]");
  return redacted;
}

export function spawnShell(command: string, cwd: string): ChildProcess {
  return spawn(command, {
    cwd,
    env: scrubbedEnv(),
    shell: true,
    // Own process group, so stopping it also stops whatever the shell started.
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  signalTree(child, "SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), sleep(STOP_GRACE_MS).then(() => false)]);
  if (!graceful) {
    signalTree(child, "SIGKILL");
    await exited;
  }
}

/** Keeps the last lines of a process's output for error messages. */
export function captureTail(child: ChildProcess, maxLines = OUTPUT_TAIL_LINES): () => string {
  const lines: string[] = [];
  // Chunks can end mid-line. Hold the unfinished part, so a secret split across two chunks is still redacted whole.
  const partial = { stdout: "", stderr: "" };
  const keep = (stream: "stdout" | "stderr") => (chunk: Buffer) => {
    const pieces = (partial[stream] + chunk.toString("utf8")).split("\n");
    partial[stream] = pieces.pop() ?? "";
    lines.push(...pieces.filter(Boolean));
    lines.splice(0, Math.max(0, lines.length - maxLines));
  };
  child.stdout?.on("data", keep("stdout"));
  child.stderr?.on("data", keep("stderr"));
  return () => redactSecrets([...lines, partial.stdout, partial.stderr].filter(Boolean).slice(-maxLines).join("\n"));
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  /** Last lines of stdout and stderr, with secrets redacted. */
  output: string;
}

export async function runCommand(command: string, cwd: string, timeoutSeconds: number): Promise<CommandResult> {
  const child = spawnShell(command, cwd);
  const tail = captureTail(child);

  const finished = new Promise<number | null>((done) => {
    child.once("error", () => done(null));
    child.once("exit", (code) => done(code));
  });
  const controller = new AbortController();
  const timeout = sleep(timeoutSeconds * 1000, "timeout" as const, { signal: controller.signal }).catch(() => "done");

  const outcome = await Promise.race([finished, timeout]);
  if (outcome === "timeout") {
    await stopProcess(child);
    return { command, exitCode: null, timedOut: true, output: tail() };
  }
  controller.abort();
  return { command, exitCode: outcome as number | null, timedOut: false, output: tail() };
}
