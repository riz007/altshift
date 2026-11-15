import { describe, expect, it } from "vitest";
import {
  BRANCH_PREFIX,
  coveredFingerprints,
  deliver,
  findExisting,
  type GitHubApi,
  type OpenPullRequest,
  title,
} from "./deliver.js";

const BOT = "github-actions[bot]";
const HEAD = "base000000000";
const fp = (char: string) => char.repeat(64);
const FILE = { path: "app/components/Cart.vue", content: "<template />" };

/** A GitHub that records what was asked of it. */
function fakeGitHub(
  open: OpenPullRequest[] = [],
  options: { changed?: string[]; commits?: Array<{ author: string; committer: string }>; head?: string } = {},
) {
  const calls: Array<[string, unknown]> = [];
  const api: GitHubApi = {
    defaultBranch: async () => ({ name: "main", sha: options.head ?? HEAD }),
    openPullRequests: async () => open,
    changedFiles: async () => options.changed ?? [],
    commitAuthors: async () => options.commits ?? [{ author: BOT, committer: BOT }],
    ownLogin: async () => BOT,
    commit: async (input) => {
      calls.push(["commit", input]);
      return "c0ffee1234567890";
    },
    createBranch: async (name, sha) => void calls.push(["createBranch", { name, sha }]),
    advanceBranch: async (name, sha) => void calls.push(["advanceBranch", { name, sha }]),
    createPullRequest: async (input) => {
      calls.push(["createPullRequest", input]);
      return { number: 7, url: "https://github.test/pull/7" };
    },
    updatePullRequest: async (number, input) => void calls.push(["updatePullRequest", { number, ...input }]),
  };
  return { api, calls };
}

const ours: OpenPullRequest = {
  number: 3,
  url: "https://github.test/pull/3",
  body: `First run.\n\n<!-- ariamend:covered ${fp("a")} -->\n`,
  branch: `${BRANCH_PREFIX}abc1234567`,
  headSha: "head111",
  sameRepo: true,
  author: BOT,
};

describe("findExisting", () => {
  it("finds the open Ariamend pull request with what it covers and changes", async () => {
    const { api } = fakeGitHub([ours], { changed: ["app/pages/index.vue"] });
    const found = await findExisting(api);
    expect(found.ok && found.value).toMatchObject({ covered: [fp("a")], files: ["app/pages/index.vue"] });
  });

  it.each([
    ["a fork", { sameRepo: false }],
    ["another branch name", { branch: "feature/ariamend/debt-abc1234567" }],
    ["a branch that only starts like ours", { branch: `${BRANCH_PREFIX}abc1234567-mine` }],
    ["a body without the marker", { body: "no marker" }],
    ["someone else as author", { author: "mallory" }],
  ])("ignores %s", async (_name, change) => {
    const found = await findExisting(fakeGitHub([{ ...ours, ...change }]).api);
    expect(found.ok && found.value).toBeUndefined();
  });

  it("ignores a pull request that has commits from anyone else", async () => {
    const commits = [
      { author: BOT, committer: BOT },
      { author: "mallory", committer: BOT },
    ];
    const found = await findExisting(fakeGitHub([ours], { commits }).api);
    expect(found.ok && found.value).toBeUndefined();
  });

  it("returns an error, not a throw, when GitHub fails", async () => {
    const { api } = fakeGitHub();
    api.openPullRequests = async () => {
      throw new Error("503");
    };
    const found = await findExisting(api);
    expect(!found.ok && found.error.code).toBe("delivery");
  });
});

describe("deliver", () => {
  const input = { files: [FILE], fingerprints: [fp("b"), fp("c")], body: "## Ariamend evidence", checkedOut: HEAD };

  it("opens one pull request from a new branch off the default branch", async () => {
    const { api, calls } = fakeGitHub();
    const result = await deliver(api, input);

    expect(result.ok && result.value).toEqual({ action: "created", url: "https://github.test/pull/7" });
    expect(calls.map(([name]) => name)).toEqual(["commit", "createBranch", "createPullRequest"]);
    expect(calls[0]?.[1]).toMatchObject({ parentSha: HEAD, files: [FILE] });
    expect(calls[1]?.[1]).toEqual({ name: `${BRANCH_PREFIX}c0ffee1234`, sha: "c0ffee1234567890" });
    expect(calls[2]?.[1]).toMatchObject({
      title: "Ariamend: fix 2 accessibility findings",
      head: `${BRANCH_PREFIX}c0ffee1234`,
      base: "main",
    });
    const created = calls[2]?.[1] as { body: string } | undefined;
    expect(coveredFingerprints(created?.body ?? "")).toEqual([fp("b"), fp("c")]);
  });

  it("adds to the open pull request, updating the body before the branch moves", async () => {
    const { api, calls } = fakeGitHub();
    const existing = { pullRequest: ours, covered: [fp("a")], files: ["app/pages/index.vue"] };
    const result = await deliver(api, { ...input, existing });

    expect(result.ok && result.value).toEqual({ action: "updated", url: ours.url });
    expect(calls.map(([name]) => name)).toEqual(["commit", "updatePullRequest", "advanceBranch"]);
    expect(calls[0]?.[1]).toMatchObject({ parentSha: "head111" });
    expect(calls[2]?.[1]).toEqual({ name: ours.branch, sha: "c0ffee1234567890" });

    const update = calls[1]?.[1] as { title: string; body: string };
    expect(update.title).toBe("Ariamend: fix 3 accessibility findings");
    expect(coveredFingerprints(update.body)).toEqual([fp("a"), fp("b"), fp("c")]);
    expect(update.body).toContain("Earlier runs in this pull request");
    expect(update.body).toContain("First run.");
    expect(update.body.match(/ariamend:covered/g)).toHaveLength(1);
  });

  it("refuses when the default branch has moved since the run checked it out", async () => {
    const { api, calls } = fakeGitHub([], { head: "newer00000000" });
    const result = await deliver(api, input);

    expect(!result.ok && result.error.message).toContain("Run Ariamend on the latest main");
    expect(calls).toEqual([]);
  });

  it("refuses changed files that clear no finding", async () => {
    const { api, calls } = fakeGitHub();
    const result = await deliver(api, { ...input, fingerprints: [] });
    expect(!result.ok && result.error.message).toContain("clear no finding");
    expect(calls).toEqual([]);
  });

  it("never names the default branch when creating or moving a branch", async () => {
    for (const existing of [undefined, { pullRequest: ours, covered: [], files: [] }]) {
      const { api, calls } = fakeGitHub();
      await deliver(api, { ...input, ...(existing ? { existing } : {}) });
      const branches = calls
        .filter(([name]) => name === "createBranch" || name === "advanceBranch")
        .map(([, value]) => (value as { name: string }).name);
      expect(branches.length).toBeGreaterThan(0);
      expect(branches.every((name) => name.startsWith(BRANCH_PREFIX))).toBe(true);
    }
  });

  it("refuses to change a file the open pull request already changes", async () => {
    const { api, calls } = fakeGitHub();
    const existing = { pullRequest: ours, covered: [fp("a")], files: [FILE.path] };
    const result = await deliver(api, { ...input, existing });

    expect(!result.ok && result.error.message).toContain("already changed by the open Ariamend pull request");
    expect(calls).toEqual([]);
  });

  it("refuses to update a branch it did not create", async () => {
    const { api, calls } = fakeGitHub();
    const existing = { pullRequest: { ...ours, branch: "main" }, covered: [], files: [] };
    expect((await deliver(api, { ...input, existing })).ok).toBe(false);
    expect(calls).toEqual([]);
  });

  it("does nothing when there are no fixes", async () => {
    const { api, calls } = fakeGitHub();
    const result = await deliver(api, { ...input, files: [], fingerprints: [] });
    expect(result.ok && result.value).toEqual({ action: "none" });
    expect(calls).toEqual([]);
  });

  it("cuts a long body to fit, but never the marker", async () => {
    const { api, calls } = fakeGitHub();
    const many = Array.from({ length: 300 }, (_, index) => index.toString(16).padStart(64, "0"));
    await deliver(api, { ...input, fingerprints: many, body: "x".repeat(100_000) });

    const created = calls.find(([name]) => name === "createPullRequest")?.[1] as { body: string };
    expect(created.body.length).toBeLessThanOrEqual(60_000);
    expect(created.body).toContain("Shortened to fit");
    expect(coveredFingerprints(created.body)).toHaveLength(300);
  });

  it("reports a failed push as an error and opens no pull request", async () => {
    const { api, calls } = fakeGitHub();
    api.createBranch = async () => {
      throw new Error("Reference update failed: protected branch");
    };
    const result = await deliver(api, input);

    expect(!result.ok && result.error.message).toContain("protected branch");
    expect(calls.map(([name]) => name)).toEqual(["commit"]);
  });
});

describe("markers and titles", () => {
  it("reads only well-formed fingerprints from a body", () => {
    expect(coveredFingerprints(`<!-- ariamend:covered ${fp("a")},nonsense,${fp("b")} -->`)).toEqual([fp("a"), fp("b")]);
    expect(coveredFingerprints("no marker")).toEqual([]);
  });

  it("uses the singular for one finding", () => {
    expect(title(1)).toBe("Ariamend: fix 1 accessibility finding");
  });
});
