import { getConfig, type GitlabHost } from "../config.js";
import type { RepoRef } from "../scm/ref.js";

export class GitlabApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GitlabApiError";
  }
}

export function getGitlabHost(host: string): GitlabHost {
  const config = getConfig().gitlabHosts.get(host);
  if (!config) {
    throw new Error(
      `No GitLab token configured for ${host} — set GITLAB_TOKENS=${host}=<token> (see .env.example)`,
    );
  }
  return config;
}

/** API path prefix for a project, addressed by its URL-encoded full path. */
export function projectApi(repo: RepoRef): string {
  return `/projects/${encodeURIComponent(repo.path)}`;
}

/**
 * Call the GitLab REST API (v4) of `host` with its configured token.
 * Throws GitlabApiError on non-2xx, carrying GitLab's error message.
 */
export async function gitlabFetch(
  host: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const { baseUrl, token } = getGitlabHost(host);
  const res = await fetch(`${baseUrl}/api/v4${path}`, {
    method,
    headers: {
      "private-token": token,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      const json = JSON.parse(text) as { message?: unknown; error?: unknown };
      const msg = json.message ?? json.error;
      if (msg !== undefined) detail = typeof msg === "string" ? msg : JSON.stringify(msg);
    } catch {
      // not JSON — keep the raw text
    }
    throw new GitlabApiError(
      res.status,
      `GitLab ${method} ${path} failed: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
  return res;
}

export async function gitlabJson<T>(
  host: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return (await (await gitlabFetch(host, method, path, body)).json()) as T;
}

/** True if the resource exists, false on 404; other errors propagate. */
export async function gitlabExists(host: string, path: string, method = "GET"): Promise<boolean> {
  try {
    await gitlabFetch(host, method, path);
    return true;
  } catch (err) {
    if (err instanceof GitlabApiError && err.status === 404) return false;
    throw err;
  }
}
