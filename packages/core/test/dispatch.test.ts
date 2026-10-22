import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb } from "../src/db/client.js";
import { repos, scans } from "../src/db/schema.js";
import { runScan } from "../src/scan/run-scan.js";
import { opengrepSarif, trivySarif } from "./fixtures.js";
import { GITLAB_API as API, stubGitlab } from "./gitlab-stub.js";

const TARGET = `${API}/projects/acme%2Fplatform%2Fapi`;
const SCAN = `${API}/projects/sec%2Fproofhouse-scan`;

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "proofhouse-scan-dispatch-")), "t.db");
}

beforeAll(() => {
  process.env.GITLAB_TOKENS = "gitlab.com=glpat-com,git.corp.io=glpat-corp";
  process.env.GITLAB_SCAN_PROJECTS = "gitlab.com=sec/proofhouse-scan";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runScan for GitLab", () => {
  it("dispatches a pipeline in the host's scan project and ingests its job artifacts", async () => {
    const calls = stubGitlab({
      [`GET ${TARGET}`]: {
        json: {
          path: "api",
          path_with_namespace: "acme/platform/api",
          namespace: { full_path: "acme/platform" },
          default_branch: "main",
          visibility: "private",
        },
      },
      [`GET ${SCAN}`]: { json: { default_branch: "main" } },
      [`POST ${SCAN}/pipeline`]: {
        status: 201,
        json: { id: 77, web_url: "https://gitlab.com/sec/proofhouse-scan/-/pipelines/77" },
      },
      [`GET ${SCAN}/pipelines/77`]: { json: { status: "success" } },
      [`GET ${SCAN}/pipelines/77/jobs?per_page=100`]: {
        json: [
          { id: 1, name: "meta" },
          { id: 2, name: "opengrep" },
          { id: 3, name: "trivy" },
          { id: 4, name: "gitleaks" }, // no artifact → reported missing
        ],
      },
      [`GET ${SCAN}/jobs/1/artifacts/meta.json`]: { text: '{"commit_sha":"abc123"}' },
      [`GET ${SCAN}/jobs/2/artifacts/opengrep.sarif`]: { text: opengrepSarif },
      [`GET ${SCAN}/jobs/3/artifacts/trivy.sarif`]: { text: trivySarif },
    });
    const db = openDb(tempDbPath());

    const summary = await runScan(db, { targetRepo: "https://gitlab.com/acme/platform/api", targetRef: "develop" });

    expect(summary).toMatchObject({
      targetRepo: "gitlab.com/acme/platform/api",
      commitSha: "abc123",
      runUrl: "https://gitlab.com/sec/proofhouse-scan/-/pipelines/77",
      scannersIngested: ["opengrep", "trivy"],
      scannersMissing: ["gitleaks"],
    });
    expect(summary.counts.new).toBe(3); // 1 sast + 2 trivy

    const dispatch = calls.find((c) => c.method === "POST")!;
    expect(dispatch.body).toEqual({
      ref: "main",
      inputs: {
        target_project: "acme/platform/api",
        target_ref: "develop",
        correlation_id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    expect(db.select().from(repos).get()).toMatchObject({
      provider: "gitlab",
      fullName: "gitlab.com/acme/platform/api",
      owner: "acme/platform",
      isPrivate: true,
    });
    expect(db.select().from(scans).get()).toMatchObject({
      workflowRunId: 77,
      status: "completed",
      source: "dispatch",
      commitSha: "abc123",
    });
  });

  it("fails the scan clearly when the host has no scan project", async () => {
    stubGitlab({
      [`GET https://git.corp.io/api/v4/projects/team%2Fsvc`]: {
        json: { path: "svc", path_with_namespace: "team/svc", namespace: { full_path: "team" }, default_branch: "main", visibility: "internal" },
      },
    });
    const db = openDb(tempDbPath());

    await expect(runScan(db, { targetRepo: "git.corp.io/team/svc" })).rejects.toThrow(
      /No GitLab scan project configured for git.corp.io/,
    );
    expect(db.select().from(scans).get()).toMatchObject({ status: "failed" });
  });
});
