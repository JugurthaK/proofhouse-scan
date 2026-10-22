// Provider-neutral entry points for code that works on a stored repo: each
// call routes to the GitHub or GitLab implementation by repo.provider.
import type { Repo } from "../db/schema.js";
import { getOctokit } from "../github/client.js";
import { fetchFileContent } from "../github/content.js";
import { createFixPr, type CreatedPr, type FileChange } from "../github/pr.js";
import {
  dispatchScan,
  downloadArtifacts,
  waitForRun,
  type ArtifactContents,
  type CompletedRun,
  type DispatchedRun,
} from "../github/workflow.js";
import { gitlabJson, projectApi } from "../gitlab/client.js";
import { fetchGitlabFileContent } from "../gitlab/content.js";
import { createFixMr } from "../gitlab/mr.js";
import {
  dispatchGitlabScan,
  downloadGitlabArtifacts,
  waitForGitlabPipeline,
} from "../gitlab/pipeline.js";
import { parseRepoRef, type RepoRef } from "./ref.js";

export type ScmRepo = Pick<Repo, "provider" | "fullName">;

/** Repo metadata as the host reports it — canonical names and casing. */
export interface RepoMeta {
  provider: Repo["provider"];
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
}

export async function fetchRepoMeta(ref: RepoRef): Promise<RepoMeta> {
  if (ref.provider === "gitlab") {
    const project = await gitlabJson<{
      path: string;
      path_with_namespace: string;
      namespace: { full_path: string };
      default_branch: string | null;
      visibility: string;
    }>(ref.host, "GET", projectApi(ref));
    return {
      provider: "gitlab",
      owner: project.namespace.full_path,
      name: project.path,
      fullName: `${ref.host}/${project.path_with_namespace}`,
      defaultBranch: project.default_branch,
      isPrivate: project.visibility !== "public",
    };
  }
  const { data } = await getOctokit().rest.repos.get({ owner: ref.owner, repo: ref.name });
  return {
    provider: "github",
    owner: data.owner.login,
    name: data.name,
    fullName: data.full_name,
    defaultBranch: data.default_branch,
    isPrivate: data.private,
  };
}

/** Start a central scan: GitHub workflow dispatch, or a GitLab pipeline. */
export function dispatchRepoScan(
  repo: ScmRepo,
  options: { targetRef?: string; onProgress?: (msg: string) => void },
): Promise<DispatchedRun> {
  return repo.provider === "gitlab"
    ? dispatchGitlabScan({ target: parseRepoRef(repo.fullName, "gitlab"), ...options })
    : dispatchScan({ targetRepo: repo.fullName, ...options });
}

export function waitForRepoScan(
  repo: ScmRepo,
  run: DispatchedRun,
  options: { timeoutMs?: number; onProgress?: (msg: string) => void } = {},
): Promise<CompletedRun> {
  return repo.provider === "gitlab"
    ? waitForGitlabPipeline(parseRepoRef(repo.fullName, "gitlab"), run, options)
    : waitForRun(run, options);
}

export function downloadRepoScanArtifacts(
  repo: ScmRepo,
  run: DispatchedRun,
): Promise<ArtifactContents> {
  return repo.provider === "gitlab"
    ? downloadGitlabArtifacts(parseRepoRef(repo.fullName, "gitlab"), run.runId)
    : downloadArtifacts(run.runId);
}

/** "pull request" or "merge request", for messages and PR/MR bodies. */
export function changeRequestNoun(repo: ScmRepo): string {
  return repo.provider === "gitlab" ? "merge request" : "pull request";
}

export function fetchRepoFile(repo: ScmRepo, path: string, ref?: string): Promise<string | null> {
  return repo.provider === "gitlab"
    ? fetchGitlabFileContent(parseRepoRef(repo.fullName, "gitlab"), path, ref)
    : fetchFileContent(repo.fullName, path, ref);
}

/** Open a fix PR (GitHub) or MR (GitLab) from the default branch. */
export function openFixRequest(
  repo: ScmRepo,
  options: {
    branchName: string;
    files: FileChange[];
    commitMessage: string;
    title: string;
    body: string;
    onProgress?: (msg: string) => void;
  },
): Promise<CreatedPr> {
  if (repo.provider === "gitlab") {
    return createFixMr({
      targetRepo: parseRepoRef(repo.fullName, "gitlab"),
      branchName: options.branchName,
      files: options.files,
      commitMessage: options.commitMessage,
      title: options.title,
      description: options.body,
      onProgress: options.onProgress,
    });
  }
  return createFixPr({
    targetRepo: repo.fullName,
    branchName: options.branchName,
    files: options.files,
    commitMessage: options.commitMessage,
    prTitle: options.title,
    prBody: options.body,
    onProgress: options.onProgress,
  });
}
