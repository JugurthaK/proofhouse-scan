import { vi } from "vitest";

export interface GitlabCall {
  method: string;
  url: string;
  token: string | null;
  body: unknown;
}

export type GitlabRoute = { status?: number; json?: unknown; text?: string };

export const GITLAB_API = "https://gitlab.com/api/v4";

/** Stub fetch with exact "METHOD url" routes; unmatched requests 404. */
export function stubGitlab(routes: Record<string, GitlabRoute>): GitlabCall[] {
  const calls: GitlabCall[] = [];
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
