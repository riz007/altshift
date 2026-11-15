import { getOctokit } from "@actions/github";
import type { GitHubApi } from "./deliver.js";

/** The real GitHub client. `repository` is "owner/name", as in GITHUB_REPOSITORY. */
export function createGitHubApi(token: string, repository: string): GitHubApi {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error(`"${repository}" is not an owner/name repository.`);
  const octokit = getOctokit(token);
  const at = { owner, repo };

  return {
    async defaultBranch() {
      const name = (await octokit.rest.repos.get(at)).data.default_branch;
      const ref = await octokit.rest.git.getRef({ ...at, ref: `heads/${name}` });
      return { name, sha: ref.data.object.sha };
    },

    async openPullRequests(base) {
      const pulls = await octokit.paginate(octokit.rest.pulls.list, { ...at, state: "open", base, per_page: 100 });
      return pulls.map((pull) => ({
        number: pull.number,
        url: pull.html_url,
        body: pull.body ?? "",
        branch: pull.head.ref,
        headSha: pull.head.sha,
        sameRepo: pull.head.repo?.full_name === repository,
        author: pull.user?.login ?? "",
      }));
    },

    async commitAuthors(pullRequest) {
      const commits = await octokit.paginate(octokit.rest.pulls.listCommits, {
        ...at,
        pull_number: pullRequest,
        per_page: 100,
      });
      return commits.map((commit) => ({
        author: commit.author?.login ?? "",
        committer: commit.committer?.login ?? "",
      }));
    },

    async ownLogin() {
      // A personal token can say who it is. The Actions token cannot, and always acts as github-actions[bot].
      try {
        return (await octokit.rest.users.getAuthenticated()).data.login;
      } catch {
        return "github-actions[bot]";
      }
    },

    async changedFiles(pullRequest) {
      const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
        ...at,
        pull_number: pullRequest,
        per_page: 100,
      });
      return files.map((file) => file.filename);
    },

    async commit({ parentSha, message, files }) {
      const parent = await octokit.rest.git.getCommit({ ...at, commit_sha: parentSha });
      const tree = await octokit.rest.git.createTree({
        ...at,
        base_tree: parent.data.tree.sha,
        tree: files.map((file) => ({
          path: file.path,
          mode: "100644" as const,
          type: "blob" as const,
          content: file.content,
        })),
      });
      const commit = await octokit.rest.git.createCommit({ ...at, message, tree: tree.data.sha, parents: [parentSha] });
      return commit.data.sha;
    },

    async createBranch(name, sha) {
      await octokit.rest.git.createRef({ ...at, ref: `refs/heads/${name}`, sha });
    },

    async advanceBranch(name, sha) {
      await octokit.rest.git.updateRef({ ...at, ref: `heads/${name}`, sha, force: false });
    },

    async createPullRequest({ title, body, head, base }) {
      const pull = await octokit.rest.pulls.create({ ...at, title, body, head, base });
      return { number: pull.data.number, url: pull.data.html_url };
    },

    async updatePullRequest(pullRequest, { title, body }) {
      await octokit.rest.pulls.update({ ...at, pull_number: pullRequest, title, body });
    },
  };
}
