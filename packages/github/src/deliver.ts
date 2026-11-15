import { errorMessage, fail, ok, type Result } from "@ariamend/core";

// Delivery never touches the default branch: it only creates and fast-forwards branches under this prefix.
export const BRANCH_PREFIX = "ariamend/debt-";
const OUR_BRANCH = /^ariamend\/debt-[0-9a-f]{10}$/;
const MARKER = /<!-- ariamend:covered ([\w,]*) -->/;
// GitHub rejects bodies over 65,536 characters.
const MAX_BODY = 60_000;

export interface FileContent {
  /** Repo-relative path with forward slashes. */
  path: string;
  content: string;
}

export interface OpenPullRequest {
  number: number;
  url: string;
  body: string;
  branch: string;
  headSha: string;
  /** False for a pull request from a fork. Those are never ours. */
  sameRepo: boolean;
  /** Login of whoever opened it. */
  author: string;
}

/** The few GitHub operations delivery needs. The real client and the test double both implement it. */
export interface GitHubApi {
  defaultBranch(): Promise<{ name: string; sha: string }>;
  openPullRequests(base: string): Promise<OpenPullRequest[]>;
  changedFiles(pullRequest: number): Promise<string[]>;
  /** Author and committer logins of every commit in the pull request. Empty where GitHub knows no account. */
  commitAuthors(pullRequest: number): Promise<Array<{ author: string; committer: string }>>;
  /** The login Ariamend acts as, e.g. "github-actions[bot]". */
  ownLogin(): Promise<string>;
  /** Create a commit on top of `parentSha` that sets exactly these files. Returns the new commit's sha. */
  commit(input: { parentSha: string; message: string; files: FileContent[] }): Promise<string>;
  createBranch(name: string, sha: string): Promise<void>;
  /** Fast-forward only. Must fail, not force, if the branch has moved. */
  advanceBranch(name: string, sha: string): Promise<void>;
  createPullRequest(input: {
    title: string;
    body: string;
    head: string;
    base: string;
  }): Promise<{ number: number; url: string }>;
  updatePullRequest(pullRequest: number, input: { title: string; body: string }): Promise<void>;
}

export interface ExistingDelivery {
  pullRequest: OpenPullRequest;
  /** Fingerprints the open pull request already fixes. */
  covered: string[];
  /** Files it already changes. New fixes to these wait for the next run. */
  files: string[];
}

export function coveredFingerprints(body: string): string[] {
  const list = MARKER.exec(body)?.[1] ?? "";
  return list.split(",").filter((item) => /^[0-9a-f]{64}$/.test(item));
}

/** The body with the marker at the end. Prose is cut to fit; the marker never is. */
function withMarker(body: string, covered: readonly string[]): string {
  const marker = `\n\n<!-- ariamend:covered ${[...new Set(covered)].sort().join(",")} -->\n`;
  const prose = body.replace(MARKER, "").trimEnd();
  const room = MAX_BODY - marker.length;
  const fitted =
    prose.length > room
      ? `${prose.slice(0, Math.max(0, room - 80))}\n\n(Shortened to fit. The evidence pack has everything.)`
      : prose;
  return `${fitted}${marker}`;
}

export function title(findings: number): string {
  return `Ariamend: fix ${findings} accessibility finding${findings === 1 ? "" : "s"}`;
}

/**
 * The open Ariamend pull request against the default branch, if there is one. Only a pull request that
 * Ariamend's own identity opened, and whose every commit it made, counts. Anyone else could otherwise
 * suppress fixes by listing their fingerprints, or have their commits presented under Ariamend's evidence.
 */
export async function findExisting(api: GitHubApi): Promise<Result<ExistingDelivery | undefined>> {
  try {
    const base = await api.defaultBranch();
    const self = await api.ownLogin();
    const candidates = (await api.openPullRequests(base.name))
      .filter((item) => item.sameRepo && OUR_BRANCH.test(item.branch) && item.author === self && MARKER.test(item.body))
      .sort((a, b) => a.number - b.number);
    for (const candidate of candidates) {
      const commits = await api.commitAuthors(candidate.number);
      if (commits.length === 0 || commits.some((commit) => commit.author !== self || commit.committer !== self))
        continue;
      return ok({
        pullRequest: candidate,
        covered: coveredFingerprints(candidate.body),
        files: await api.changedFiles(candidate.number),
      });
    }
    return ok(undefined);
  } catch (error) {
    return fail("delivery", `Could not read pull requests: ${errorMessage(error)}`);
  }
}

export interface DeliveryInput {
  /** Final content of every file the gated fixes changed. */
  files: FileContent[];
  /** Fingerprints these fixes clear. */
  fingerprints: string[];
  /** Markdown for this run. Must already be escaped. */
  body: string;
  /** The commit the fixes were computed from. Delivery refuses unless it is still the default branch head. */
  checkedOut: string;
  existing?: ExistingDelivery;
}

export interface Delivery {
  /** Undefined when there was nothing to deliver and no pull request is open. */
  url?: string;
  action: "created" | "updated" | "none";
}

/**
 * Open one pull request with the gated fixes, or add them to the open one.
 * It never pushes to the default branch, never merges and never force-pushes.
 */
export async function deliver(api: GitHubApi, input: DeliveryInput): Promise<Result<Delivery>> {
  const { existing } = input;
  if (input.files.length === 0) return ok({ action: "none", ...(existing ? { url: existing.pullRequest.url } : {}) });
  if (input.fingerprints.length === 0) {
    return fail("delivery", "Refusing to deliver changed files that clear no finding.");
  }

  try {
    // Whole files are committed, so they must come from the commit they will land on. This also keeps
    // a run on another branch, or on a working tree with other changes, from delivering that content.
    const head = await api.defaultBranch();
    if (head.sha !== input.checkedOut) {
      return fail(
        "delivery",
        `This run checked out ${input.checkedOut.slice(0, 10)}, but ${head.name} is at ${head.sha.slice(0, 10)}. Run Ariamend on the latest ${head.name}.`,
      );
    }

    if (existing !== undefined) {
      const taken = new Set(existing.files);
      const clash = input.files.find((file) => taken.has(file.path));
      if (clash !== undefined) {
        return fail("delivery", `${clash.path} is already changed by the open Ariamend pull request.`);
      }
      if (!OUR_BRANCH.test(existing.pullRequest.branch)) {
        return fail("delivery", "Refusing to update a branch Ariamend did not create.");
      }

      const covered = [...existing.covered, ...input.fingerprints];
      const sha = await api.commit({
        parentSha: existing.pullRequest.headSha,
        message: title(input.fingerprints.length),
        files: input.files,
      });
      // The marker is updated before the branch moves. If the second step fails, the worst case is
      // findings listed as covered that are not, and they come back once the pull request closes.
      // The other order would leave fixes on the branch that later runs pay to make again.
      const earlier = existing.pullRequest.body.replace(MARKER, "").trim();
      await api.updatePullRequest(existing.pullRequest.number, {
        title: title(new Set(covered).size),
        body: withMarker(`${input.body.trim()}\n\n---\n\nEarlier runs in this pull request:\n\n${earlier}`, covered),
      });
      await api.advanceBranch(existing.pullRequest.branch, sha);
      return ok({ action: "updated", url: existing.pullRequest.url });
    }

    const sha = await api.commit({
      parentSha: head.sha,
      message: title(input.fingerprints.length),
      files: input.files,
    });
    const branch = `${BRANCH_PREFIX}${sha.slice(0, 10)}`;
    await api.createBranch(branch, sha);
    const created = await api.createPullRequest({
      title: title(new Set(input.fingerprints).size),
      body: withMarker(input.body, input.fingerprints),
      head: branch,
      base: head.name,
    });
    return ok({ action: "created", url: created.url });
  } catch (error) {
    return fail("delivery", `Could not deliver the pull request: ${errorMessage(error)}`);
  }
}

/** The two operations a debt run needs, in the shape the fix engine expects. */
export function deliveryPort(api: GitHubApi) {
  return {
    existing: () => findExisting(api),
    deliver: (input: DeliveryInput) => deliver(api, input),
  };
}
