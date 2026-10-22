import type { CreatedPr, FileChange } from "../github/pr.js";
import type { RepoRef } from "../scm/ref.js";
import { GitlabApiError, gitlabExists, gitlabJson, projectApi } from "./client.js";

const DEVELOPER = 30;
const ROLES: Record<number, string> = {
  5: "Minimal Access",
  10: "Guest",
  15: "Planner",
  20: "Reporter",
  30: "Developer",
  40: "Maintainer",
  50: "Owner",
};

/**
 * Fail early, with a readable message, unless the token's user can push a
 * branch: Developer or above (inherited group membership counts), or admin.
 */
async function assertCanPush(repo: RepoRef): Promise<void> {
  const user = await gitlabJson<{ id: number; username: string; is_admin?: boolean }>(
    repo.host,
    "GET",
    "/user",
  );
  if (user.is_admin) return;
  let level = 0;
  try {
    const member = await gitlabJson<{ access_level: number }>(
      repo.host,
      "GET",
      `${projectApi(repo)}/members/all/${user.id}`,
    );
    level = member.access_level;
  } catch (err) {
    if (!(err instanceof GitlabApiError && err.status === 404)) throw err;
  }
  if (level < DEVELOPER) {
    throw new Error(
      `${user.username} needs at least the Developer role on ${repo.fullName} to push a fix branch ` +
        `(has ${ROLES[level] ?? "no access"})`,
    );
  }
}

/**
 * Open a fix merge request against `targetRepo`: one atomic commit on a new
 * branch from the default branch, then an MR back into it. Requires the
 * Developer role — unlike GitHub there is no fork fallback.
 */
export async function createFixMr(options: {
  targetRepo: RepoRef;
  branchName: string;
  files: FileChange[];
  commitMessage: string;
  title: string;
  description: string;
  onProgress?: (msg: string) => void;
}): Promise<CreatedPr> {
  const repo = options.targetRepo;
  const project = projectApi(repo);
  const progress = options.onProgress ?? (() => {});

  const info = await gitlabJson<{ default_branch: string | null }>(repo.host, "GET", project);
  const baseBranch = info.default_branch;
  if (!baseBranch) throw new Error(`${repo.fullName} has no default branch (empty repository?)`);

  await assertCanPush(repo);
  progress(`Write access confirmed — pushing branch directly to ${repo.fullName}`);

  const branch = encodeURIComponent(options.branchName);
  if (await gitlabExists(repo.host, `${project}/repository/branches/${branch}`)) {
    throw new Error(`Branch ${options.branchName} already exists on ${repo.fullName}`);
  }

  // The Commits API needs create vs update per file, so check each one.
  const actions = await Promise.all(
    options.files.map(async (file) => {
      const exists = await gitlabExists(
        repo.host,
        `${project}/repository/files/${encodeURIComponent(file.path)}?ref=${encodeURIComponent(baseBranch)}`,
        "HEAD",
      );
      return {
        action: exists ? "update" : "create",
        file_path: file.path,
        content: Buffer.from(file.newContent, "utf8").toString("base64"),
        encoding: "base64",
      };
    }),
  );
  const commit = await gitlabJson<{ id: string }>(repo.host, "POST", `${project}/repository/commits`, {
    branch: options.branchName,
    start_branch: baseBranch,
    commit_message: options.commitMessage,
    actions,
  });
  progress(`Created branch ${options.branchName}`);
  progress(`Committed ${options.files.length} file(s): ${commit.id.slice(0, 8)}`);

  const mr = await gitlabJson<{ iid: number; web_url: string }>(
    repo.host,
    "POST",
    `${project}/merge_requests`,
    {
      source_branch: options.branchName,
      target_branch: baseBranch,
      title: options.title,
      description: options.description,
      remove_source_branch: true,
    },
  );
  progress(`Opened MR !${mr.iid}: ${mr.web_url}`);

  return {
    prUrl: mr.web_url,
    prNumber: mr.iid,
    branchName: options.branchName,
    usedFork: false,
    forkFullName: null,
  };
}
