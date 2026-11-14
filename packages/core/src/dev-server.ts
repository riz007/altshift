import { setTimeout as sleep } from "node:timers/promises";
import { captureTail, spawnShell, stopProcess } from "./command.js";
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

async function responds(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

export async function startDevServer(options: DevServerOptions): Promise<Result<DevServer>> {
  if (await responds(options.url)) {
    // On a developer's machine, reusing a running server saves a minute. In CI nothing should be
    // listening yet, and scanning an unknown process would make the rescan meaningless.
    if (process.env.CI) {
      return fail(
        "dev-server",
        `Something is already listening on ${options.url}. AltShift must start the dev server itself in CI.`,
      );
    }
    return ok({ reused: true, stop: async () => {} });
  }

  const child = spawnShell(options.command, options.cwd);
  const tail = captureTail(child, 20);

  let spawnError: Error | undefined;
  child.once("error", (error) => {
    spawnError = error;
  });

  const deadline = Date.now() + options.readyTimeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (spawnError !== undefined || child.exitCode !== null || child.signalCode !== null) {
      const reason = spawnError?.message ?? `exited with code ${child.exitCode ?? child.signalCode}`;
      return fail("dev-server", `"${options.command}" ${reason} before ${options.url} responded.\n${tail()}`);
    }
    if (await responds(options.url)) return ok({ reused: false, stop: () => stopProcess(child) });
    await sleep(POLL_MS);
  }

  await stopProcess(child);
  return fail(
    "dev-server",
    `${options.url} did not respond within ${options.readyTimeoutSeconds}s of starting "${options.command}".\n${tail()}`,
  );
}
