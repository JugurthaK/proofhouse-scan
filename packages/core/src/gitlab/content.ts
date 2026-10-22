import type { RepoRef } from "../scm/ref.js";
import { gitlabFetch, GitlabApiError, projectApi } from "./client.js";

/**
 * Fetch a file's content from a GitLab project at a ref via the repository
 * files API. Returns null for missing files and directories.
 */
export async function fetchGitlabFileContent(
  repo: RepoRef,
  path: string,
  ref?: string,
): Promise<string | null> {
  try {
    const res = await gitlabFetch(
      repo.host,
      "GET",
      `${projectApi(repo)}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(ref ?? "HEAD")}`,
    );
    return await res.text();
  } catch (err) {
    if (err instanceof GitlabApiError && err.status === 404) return null;
    throw err;
  }
}
