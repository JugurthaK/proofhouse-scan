import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseGitlabTokens } from "../src/config.js";
import { GitlabApiError } from "../src/gitlab/client.js";
import { fetchGitlabFileContent } from "../src/gitlab/content.js";
import { createFixMr } from "../src/gitlab/mr.js";
import { fetchRepoFile } from "../src/scm/index.js";
import { parseRepoRef } from "../src/scm/ref.js";

interface Call {
  method: string;
  url: string;
  token: string | null;
  body: unknown;
}

type Route = { status?: number; json?: unknown; text?: string };

/** Stub fetch with exact "METHOD url" routes; unmatched requests 404. */
function stubGitlab(routes: Record<string, Route>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const headers = new Headers(init.headers);
      calls.push({
        method,
        url,
        token: headers.get("private-token"),
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      const route = routes[`${method} ${url}`];
      if (!route) return new Response(JSON.stringify({ message: "404 Not Found" }), { status: 404 });
      const body = method === "HEAD" ? null : route.json !== undefined ? JSON.stringify(route.json) : (route.text ?? "");
      return new Response(body, { status: route.status ?? 200 });
    }),
  );
  return calls;
}

const API = "https://gitlab.com/api/v4";
const PROJECT = `${API}/projects/acme%2Fplatform%2Fapi`;

beforeAll(() => {
  process.env.GITLAB_TOKENS = "gitlab.com=glpat-com,http://localhost:8929=glpat-local";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseGitlabTokens", () => {
  it("maps hosts to base URLs and tokens", () => {
    const hosts = parseGitlabTokens(" git.corp.io=glpat-a , http://LocalHost:8929=glpat-b ", "glpat-c");
    expect(Object.fromEntries(hosts)).toEqual({
      "git.corp.io": { baseUrl: "https://git.corp.io", token: "glpat-a" },
      "localhost:8929": { baseUrl: "http://localhost:8929", token: "glpat-b" },
      "gitlab.com": { baseUrl: "https://gitlab.com", token: "glpat-c" },
    });
  });

  it("lets GITLAB_TOKENS override the gitlab.com shorthand", () => {
    expect(parseGitlabTokens("gitlab.com=glpat-list", "glpat-single").get("gitlab.com")?.token).toBe(
      "glpat-list",
    );
  });

  it("rejects malformed entries without echoing them", () => {
    for (const bad of ["glpat-secret", "=glpat-secret", "gitlab.com/group=glpat-secret"]) {
      const err = (() => {
        try {
          parseGitlabTokens(bad, undefined);
        } catch (e) {
          return e as Error;
        }
      })();
      expect(err?.message, bad).toMatch(/Invalid GITLAB_TOKENS entry #1/);
      expect(err?.message).not.toContain("secret");
    }
  });
});

describe("fetchGitlabFileContent", () => {
  const repo = parseRepoRef("gitlab.com/acme/platform/api");

  it("fetches raw content with the host's token, path-encoded", async () => {
    const calls = stubGitlab({
      [`GET ${PROJECT}/repository/files/src%2Fdb%2Fquery.js/raw?ref=abc123`]: { text: "select 1;" },
    });
    expect(await fetchGitlabFileContent(repo, "src/db/query.js", "abc123")).toBe("select 1;");
    expect(calls[0]?.token).toBe("glpat-com");
  });

  it("returns null for missing files and throws on other errors", async () => {
    stubGitlab({ [`GET ${PROJECT}/repository/files/boom.js/raw?ref=HEAD`]: { status: 500, json: { message: "oops" } } });
    expect(await fetchGitlabFileContent(repo, "missing.js")).toBeNull();
    await expect(fetchGitlabFileContent(repo, "boom.js")).rejects.toThrow(GitlabApiError);
    await expect(fetchGitlabFileContent(repo, "boom.js")).rejects.toThrow(/HTTP 500 — oops/);
  });

  it("requires a token for the repo's host", async () => {
    stubGitlab({});
    await expect(fetchGitlabFileContent(parseRepoRef("git.corp.io/a/b"), "x")).rejects.toThrow(
      /No GitLab token configured for git.corp.io/,
    );
  });

  it("is reachable through fetchRepoFile using the configured base URL", async () => {
    const calls = stubGitlab({
      [`GET http://localhost:8929/api/v4/projects/team%2Fsvc/repository/files/a.txt/raw?ref=main`]: { text: "hi" },
    });
    const content = await fetchRepoFile({ provider: "gitlab", fullName: "localhost:8929/team/svc" }, "a.txt", "main");
    expect(content).toBe("hi");
    expect(calls[0]?.token).toBe("glpat-local");
  });
});

describe("createFixMr", () => {
  const targetRepo = parseRepoRef("gitlab.com/acme/platform/api");
  const branch = "proofhouse-scan/fix-7-abcdef12";
  const options = {
    targetRepo,
    branchName: branch,
    files: [
      { path: "src/server.js", newContent: "fixed();\n" },
      { path: "src/new-helper.js", newContent: "export {};\n" },
    ],
    commitMessage: "fix(security): sqli in src/server.js",
    title: "fix(security): sqli in src/server.js",
    description: "body",
  };
  const base = (accessLevel: number) => ({
    [`GET ${PROJECT}`]: { json: { default_branch: "main" } },
    [`GET ${API}/user`]: { json: { id: 9, username: "bot" } },
    [`GET ${PROJECT}/members/all/9`]: { json: { access_level: accessLevel } },
  });

  it("commits create/update actions on a new branch and opens an MR", async () => {
    const calls = stubGitlab({
      ...base(30),
      [`HEAD ${PROJECT}/repository/files/src%2Fserver.js?ref=main`]: {},
      [`POST ${PROJECT}/repository/commits`]: { status: 201, json: { id: "0123456789abcdef" } },
      [`POST ${PROJECT}/merge_requests`]: {
        status: 201,
        json: { iid: 42, web_url: "https://gitlab.com/acme/platform/api/-/merge_requests/42" },
      },
    });

    const result = await createFixMr(options);
    expect(result).toEqual({
      prUrl: "https://gitlab.com/acme/platform/api/-/merge_requests/42",
      prNumber: 42,
      branchName: branch,
      usedFork: false,
      forkFullName: null,
    });

    const commit = calls.find((c) => c.url.endsWith("/repository/commits"))!;
    expect(commit.body).toEqual({
      branch,
      start_branch: "main",
      commit_message: options.commitMessage,
      actions: [
        { action: "update", file_path: "src/server.js", content: Buffer.from("fixed();\n").toString("base64"), encoding: "base64" },
        { action: "create", file_path: "src/new-helper.js", content: Buffer.from("export {};\n").toString("base64"), encoding: "base64" },
      ],
    });
    const mr = calls.find((c) => c.url.endsWith("/merge_requests"))!;
    expect(mr.body).toMatchObject({ source_branch: branch, target_branch: "main", remove_source_branch: true });
  });

  it("refuses without the Developer role and pushes nothing", async () => {
    const calls = stubGitlab(base(20));
    await expect(createFixMr(options)).rejects.toThrow(/needs at least the Developer role.*has Reporter/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("refuses when the token's user is not a member", async () => {
    const routes: Record<string, Route> = base(30);
    delete routes[`GET ${PROJECT}/members/all/9`];
    stubGitlab(routes);
    await expect(createFixMr(options)).rejects.toThrow(/has no access/);
  });

  it("refuses to reuse an existing branch", async () => {
    stubGitlab({
      ...base(40),
      [`GET ${PROJECT}/repository/branches/${encodeURIComponent(branch)}`]: { json: { name: branch } },
    });
    await expect(createFixMr(options)).rejects.toThrow(/already exists/);
  });
});
