import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

// The published package carries a copy of the fix prompt, made at build time. A stale copy means the
// CLI runs, and reports, a prompt other than the one in the source.
const source = new URL("../../fix/prompts/fix-agent.md", import.meta.url);
const copy = new URL("../prompts/fix-agent.md", import.meta.url);

describe("bundled prompt", () => {
  it("matches the source when a build has copied it", async () => {
    const built = await access(copy).then(
      () => true,
      () => false,
    );
    if (!built) return;
    expect(await readFile(copy, "utf8"), "packages/cli/prompts is stale: run pnpm build").toBe(
      await readFile(source, "utf8"),
    );
  });
});
