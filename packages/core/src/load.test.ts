import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, loadJourneys } from "./load.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ariamend-load-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("finds ariamend.config.* in the working directory and fills defaults", async () => {
    await writeFile(join(dir, "ariamend.config.mjs"), 'export default { targets: { pages: ["/", "/cart"] } };');

    const result = await loadConfig(dir);

    expect(result.ok && result.value.config.targets.pages).toEqual(["/", "/cart"]);
    expect(result.ok && result.value.config.scan.engine).toBe("axe");
    expect(result.ok && result.value.root).toBe(dir);
  });

  it("loads a TypeScript config", async () => {
    await writeFile(
      join(dir, "ariamend.config.ts"),
      'const pages: string[] = ["/typed"];\nexport default { targets: { pages } };',
    );

    const result = await loadConfig(dir);

    expect(result.ok && result.value.config.targets.pages).toEqual(["/typed"]);
  });

  it("reports a missing config", async () => {
    const result = await loadConfig(dir);
    expect(!result.ok && result.error.code).toBe("config-not-found");

    const explicit = await loadConfig(dir, "nope.config.ts");
    expect(!explicit.ok && explicit.error.code).toBe("config-not-found");
  });

  it("names the bad field in an invalid config", async () => {
    await writeFile(join(dir, "ariamend.config.mjs"), 'export default { scan: { engine: "lighthouse" } };');

    const result = await loadConfig(dir);

    expect(!result.ok && result.error.code).toBe("config-invalid");
    expect(!result.ok && result.error.message).toContain("scan.engine");
  });

  it("reports a config that throws or has no default export", async () => {
    await writeFile(join(dir, "throws.mjs"), 'throw new Error("boom");');
    await writeFile(join(dir, "empty.mjs"), "export const config = {};");

    const throws = await loadConfig(dir, "throws.mjs");
    expect(!throws.ok && throws.error.message).toContain("boom");

    const empty = await loadConfig(dir, "empty.mjs");
    expect(!empty.ok && empty.error.message).toContain("no default export");
  });
});

describe("loadJourneys", () => {
  const journey = (name: string) => `export default { name: ${JSON.stringify(name)}, run: async () => {} };`;

  beforeEach(async () => {
    await mkdir(join(dir, "journeys"));
  });

  it("returns nothing when no pattern is configured", async () => {
    const result = await loadJourneys(dir, undefined);
    expect(result.ok && result.value).toEqual([]);
  });

  it("loads matching files in path order", async () => {
    await writeFile(join(dir, "journeys", "b.journey.mjs"), journey("checkout-errors"));
    await writeFile(join(dir, "journeys", "a.journey.mjs"), journey("cart-open"));
    await writeFile(join(dir, "journeys", "helper.mjs"), "export default 1;");

    const result = await loadJourneys(dir, "./journeys/*.journey.mjs");

    expect(result.ok && result.value.map((j) => j.name)).toEqual(["cart-open", "checkout-errors"]);
  });

  it("rejects a file that is not a journey", async () => {
    await writeFile(join(dir, "journeys", "bad.journey.mjs"), 'export default { name: "/cart" };');

    const result = await loadJourneys(dir, "./journeys/*.journey.mjs");

    expect(!result.ok && result.error.code).toBe("journey-invalid");
  });

  it("rejects two journeys with the same name", async () => {
    await writeFile(join(dir, "journeys", "a.journey.mjs"), journey("cart-open"));
    await writeFile(join(dir, "journeys", "b.journey.mjs"), journey("cart-open"));

    const result = await loadJourneys(dir, "./journeys/*.journey.mjs");

    expect(!result.ok && result.error.message).toContain("used by both");
  });
});
