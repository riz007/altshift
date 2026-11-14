import { type ChildProcess, spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { fail, ok, type Result } from "./result.js";

export interface DevServerOptions {
  command: string;
  url: string;
  readyTimeoutSeconds: number;
  cwd: string;
}

export interface DevServer {
  /** True when something was already listening and we did not start it. */
  reused: boolean;
  stop(): Promise<void>;
}

const POLL_MS = 500;
const STOP_GRACE_MS = 5000;
const TAIL_LINES = 20;

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function signalTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    // The command runs through a shell, so signal the whole process group, not just the shell.
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  signalTree(child, "SIGTERM");
  const graceful = await Promise.race([exited.then(() => true), sleep(STOP_GRACE_MS).then(() => false)]);
  if (!graceful) {
    signalTree(child, "SIGKILL");
    await exited;
  }
}

export async function startDevServer(options: DevServerOptions): Promise<Result<DevServer>> {
  if (await responds(options.url)) return ok({ reused: true, stop: async () => {} });

  const child = spawn(options.command, {
    cwd: options.cwd,
    shell: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tail: string[] = [];
  const keepTail = (chunk: Buffer) => {
    tail.push(...chunk.toString("utf8").split("\n").filter(Boolean));
    tail.splice(0, Math.max(0, tail.length - TAIL_LINES));
  };
  child.stdout?.on("data", keepTail);
  child.stderr?.on("data", keepTail);

  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  const deadline = Date.now() + options.readyTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (spawnError !== undefined || child.exitCode !== null || child.signalCode !== null) {
      const reason = spawnError?.message ?? `exited with code ${child.exitCode ?? child.signalCode}`;
      return fail("dev-server", `"${options.command}" ${reason} before ${options.url} responded.\n${tail.join("\n")}`);
    }
    if (await responds(options.url)) return ok({ reused: false, stop: () => stopChild(child) });
    await sleep(POLL_MS);
  }

  await stopChild(child);
  return fail(
    "dev-server",
    `${options.url} did not respond within ${options.readyTimeoutSeconds}s of starting "${options.command}".\n${tail.join("\n")}`,
  );
}
