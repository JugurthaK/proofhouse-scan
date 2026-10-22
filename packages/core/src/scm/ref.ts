import type { Provider } from "../db/schema.js";

export interface RepoRef {
  provider: Provider;
  /** Lowercased host, with port when present (e.g. git.corp.io:8443). */
  host: string;
  /** owner/repo on GitHub; the full namespace path on GitLab (group/sub/project). */
  path: string;
  /** repos.full_name: owner/repo on GitHub, host/path on GitLab. */
  fullName: string;
  /** GitHub owner, or GitLab namespace path (group/sub). */
  owner: string;
  name: string;
}

const SEGMENT_RE = /^[\w.-]+$/;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*(:\d+)?$/;
const NEEDS_HOST = " — GitLab repos need their host, e.g. gitlab.com/group/project";

function looksLikeHost(segment: string): boolean {
  return segment.includes(".") || segment.includes(":") || segment === "localhost";
}

/**
 * Parse a repo reference: `owner/repo` (GitHub), or a host-qualified path or
 * URL. Any host other than github.com is treated as GitLab, so
 * `gitlab.com/group/sub/project` and `https://git.corp.io/team/svc.git` work.
 * Pass `provider` to reject references of the other kind.
 */
export function parseRepoRef(input: string, provider?: Provider): RepoRef {
  const invalid = (hint = "") =>
    new Error(
      `Invalid repo "${input}" — expected owner/repo (GitHub) or host/group/project (GitLab)${hint}`,
    );

  const parts = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/-\/.*$/, "") // GitLab UI URLs: group/project/-/tree/main
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .split("/");

  let host: string;
  let path: string[];
  if (parts.length === 2 && !looksLikeHost(parts[0]!)) {
    host = "github.com";
    path = parts;
  } else if (parts.length >= 3 && looksLikeHost(parts[0]!)) {
    host = parts[0]!.toLowerCase();
    path = parts.slice(1);
    if (!HOST_RE.test(host) || (host === "github.com" && path.length !== 2)) throw invalid();
  } else {
    throw invalid(parts.length >= 3 ? NEEDS_HOST : "");
  }
  if (path.some((s) => !SEGMENT_RE.test(s) || s === "." || s === "..")) throw invalid();

  const resolved: Provider = host === "github.com" ? "github" : "gitlab";
  if (provider && provider !== resolved) {
    throw invalid(provider === "gitlab" ? NEEDS_HOST : "");
  }
  return {
    provider: resolved,
    host,
    path: path.join("/"),
    fullName: resolved === "github" ? path.join("/") : `${host}/${path.join("/")}`,
    owner: path.slice(0, -1).join("/"),
    name: path.at(-1)!,
  };
}
