// Provider-neutral entry points for code that works on a stored repo: each
// call routes to the GitHub or GitLab implementation by repo.provider.
import type { Repo } from "../db/schema.js";
import { fetchFileContent } from "../github/content.js";
import { createFixPr, type CreatedPr, type FileChange } from "../github/pr.js";
import { fetchGitlabFileContent } from "../gitlab/content.js";
import { createFixMr } from "../gitlab/mr.js";
import { parseRepoRef } from "./ref.js";

export type ScmRepo = Pick<Repo, "provider" | "fullName">;

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
