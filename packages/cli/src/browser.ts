import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * Install Chromium with the exact Playwright version ariamend depends on, so the browser always
 * matches the code that drives it. Resolved from ariamend's own location, never from the project's.
 */
export function installBrowser(withDeps: boolean, write: (text: string) => void): Promise<number> {
  const require = createRequire(import.meta.url);
  let cli: string;
  try {
    cli = join(dirname(require.resolve("playwright/package.json")), "cli.js");
  } catch {
    write("ariamend install-browser: Playwright is not installed next to ariamend. Reinstall ariamend.\n");
    return Promise.resolve(2);
  }
  const args = [cli, "install", ...(withDeps ? ["--with-deps"] : []), "chromium"];
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { stdio: "inherit" });
    child.once("error", () => done(2));
    child.once("exit", (code) => done(code === 0 ? 0 : 2));
  });
}
