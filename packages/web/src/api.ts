export type Scanner = "opengrep" | "trivy" | "gitleaks";
export type Category = "sast" | "sca" | "iac" | "secret";
export type Severity = "critical" | "high" | "medium" | "low" | "info";
export type FindingStatus = "new" | "open" | "resolved" | "reopened";
export type Qualification =
  | "unqualified"
  | "qualifying"
  | "true_positive"
  | "false_positive"
  | "needs_review";

export interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string | null;
  isPrivate: boolean;
  lastScannedAt: string | null;
  openFindings: number;
  criticalOrHigh: number;
}

export interface Scan {
  id: number;
  repoId: number;
  workflowRunId: number | null;
  commitSha: string | null;
  source: "dispatch" | "action";
  ref: string | null;
  status: "dispatched" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  countsNew: number | null;
  countsResolved: number | null;
  countsOpen: number | null;
}

export interface FindingRow {
  id: number;
  repoId: number;
  repo: string;
  scanner: Scanner;
  category: Category;
  ruleId: string;
  message: string;
  severity: Severity;
  filePath: string;
  startLine: number | null;
  status: FindingStatus;
  qualification: Qualification;
  updatedAt: string;
}

export interface QualificationRow {
  id: number;
  findingId: number;
  verdict: "true_positive" | "false_positive" | "needs_review" | null;
  confidence: number | null;
  reasoning: string | null;
  exploitScenario: string | null;
  model: string | null;
  status: "running" | "done" | "failed";
  error: string | null;
  createdAt: string;
}

export interface RemediationRow {
  id: number;
  findingId: number;
  status: "generating" | "patch_ready" | "branch_pushed" | "pr_opened" | "failed";
  explanation: string | null;
  patchDiff: string | null;
  branchName: string | null;
  prUrl: string | null;
  prNumber: number | null;
  usedFork: boolean | null;
  forkFullName: string | null;
  model: string | null;
  error: string | null;
  createdAt: string;
}

export interface FindingDetail extends Omit<FindingRow, "repo"> {
  fingerprint: string;
  endLine: number | null;
  snippet: string | null;
  rawSarif: string | null;
  repo: RepoSummary | null;
  qualifications: QualificationRow[];
  remediations: RemediationRow[];
}

export interface FindingsPage {
  total: number;
  page: number;
  pageSize: number;
  findings: FindingRow[];
}

export interface StatsSummary {
  bySeverity: { severity: Severity; count: number }[];
  byScanner: { scanner: Scanner; count: number }[];
  byCategory: { category: Category; count: number }[];
  byQualification: { qualification: Qualification; count: number }[];
}

export interface TimelinePoint {
  scanId: number;
  repoId: number;
  finishedAt: string | null;
  countsNew: number | null;
  countsResolved: number | null;
  countsOpen: number | null;
}

export interface SessionUser {
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

/** Server-side redirect into GitHub's OAuth flow; returns to `next` after. */
export function githubLoginUrl(next: string | null): string {
  return `/api/auth/github/login${next ? `?${new URLSearchParams({ next })}` : ""}`;
}

// Auth is an HttpOnly session cookie set by the GitHub callback; same-origin
// fetches send it automatically.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  if (res.status === 401) {
    if (window.location.pathname !== "/login") {
      const next = window.location.pathname + window.location.search;
      window.location.assign(`/login?${new URLSearchParams({ next })}`);
    }
    throw new Error("unauthorized");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  me: () => request<{ user: SessionUser | null }>("/api/auth/me"),
  logout: () => request<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
  repos: () => request<RepoSummary[]>("/api/repos"),
  repo: (id: number) =>
    request<RepoSummary & { scans: Scan[] }>(`/api/repos/${id}`),
  findings: (params: Record<string, string>) =>
    request<FindingsPage>(`/api/findings?${new URLSearchParams(params)}`),
  finding: (id: number) => request<FindingDetail>(`/api/findings/${id}`),
  statsSummary: (repoId?: number) =>
    request<StatsSummary>(
      `/api/stats/summary${repoId ? `?repo_id=${repoId}` : ""}`,
    ),
  timeline: (repoId?: number) =>
    request<TimelinePoint[]>(
      `/api/stats/timeline${repoId ? `?repo_id=${repoId}` : ""}`,
    ),
  qualify: (findingId: number) =>
    request<{ started: boolean }>(`/api/findings/${findingId}/qualify`, {
      method: "POST",
    }),
  remediate: (findingId: number) =>
    request<{ started: boolean }>(`/api/findings/${findingId}/remediate`, {
      method: "POST",
    }),
  rescan: (repo: string) =>
    request<{ started: boolean }>("/api/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo }),
    }),
};
