import { findings, openDb, repos, scans, type Db } from "@proofhouse-scan/core";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// Any of these would put the API behind auth; the filter tests want it open.
const AUTH_ENV = [
  "PROOFHOUSE_SCAN_API_TOKEN",
  "PROOFHOUSE_SCAN_INGEST_TOKEN",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "PROOFHOUSE_SCAN_ALLOWED_USERS",
  "PROOFHOUSE_SCAN_ALLOWED_ORGS",
];

type Seed = Partial<typeof findings.$inferInsert> & { repoId: number };

function seed(db: Db) {
  const now = new Date().toISOString();
  const [api, web] = db
    .insert(repos)
    .values([
      { owner: "acme", name: "api", fullName: "acme/api", createdAt: now },
      { owner: "acme", name: "web", fullName: "acme/web", createdAt: now },
    ])
    .returning()
    .all();
  const scan = (repoId: number) =>
    db
      .insert(scans)
      .values({ repoId, correlationId: `c${repoId}`, status: "completed", startedAt: now })
      .returning()
      .get();
  const scanIds = { [api!.id]: scan(api!.id).id, [web!.id]: scan(web!.id).id };

  let n = 0;
  const finding = (f: Seed) => ({
    fingerprint: `fp${++n}`,
    scanner: "opengrep" as const,
    category: "sast" as const,
    ruleId: `rule-${n}`,
    message: "Something looks off",
    severity: "medium" as const,
    filePath: "src/index.ts",
    status: "open" as const,
    firstSeenScanId: scanIds[f.repoId]!,
    lastSeenScanId: scanIds[f.repoId]!,
    createdAt: now,
    updatedAt: now,
    ...f,
  });
  db.insert(findings)
    .values([
      finding({ repoId: api!.id, severity: "critical", ruleId: "javascript.express.tainted-sql-string" }),
      finding({ repoId: api!.id, severity: "high", status: "new", message: "SQL built from user input" }),
      finding({ repoId: api!.id, severity: "low", status: "resolved" }),
      finding({ repoId: web!.id, severity: "high", status: "reopened", filePath: "src/Sql/Builder.ts" }),
      finding({ repoId: web!.id, severity: "info", message: "Coverage is 100% (not a wildcard)" }),
      finding({ repoId: web!.id, severity: "critical", status: "resolved", qualification: "true_positive" }),
    ])
    .run();
  return { api: api!, web: web! };
}

let savedEnv: Record<string, string | undefined>;
let app: FastifyInstance;
let ids: ReturnType<typeof seed>;

beforeEach(() => {
  savedEnv = Object.fromEntries(AUTH_ENV.map((k) => [k, process.env[k]]));
  for (const key of AUTH_ENV) delete process.env[key];
  const db = openDb(join(mkdtempSync(join(tmpdir(), "proofhouse-scan-findings-")), "t.db"));
  ids = seed(db);
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function list(query: string) {
  const res = await app.inject({ method: "GET", url: `/api/findings?${query}` });
  return { status: res.statusCode, body: res.json() as { total: number; findings: { id: number; severity: string; status: string; repoId: number }[]; error?: string } };
}

describe("GET /api/findings", () => {
  it("returns everything, resolved included, when unfiltered", async () => {
    const { body } = await list("");
    expect(body.total).toBe(6);
  });

  it("treats status=unresolved as new + open + reopened", async () => {
    const { body } = await list("status=unresolved");
    expect(body.total).toBe(4);
    expect(body.findings.every((f) => f.status !== "resolved")).toBe(true);
  });

  it("agrees with the stats summary and repo counts for unresolved findings", async () => {
    const stats = (await app.inject({ url: "/api/stats/summary" })).json() as {
      bySeverity: { count: number }[];
    };
    const repoList = (await app.inject({ url: "/api/repos" })).json() as { openFindings: number }[];
    const { body } = await list("status=unresolved");
    expect(stats.bySeverity.reduce((s, x) => s + x.count, 0)).toBe(body.total);
    expect(repoList.reduce((s, r) => s + r.openFindings, 0)).toBe(body.total);
  });

  it("accepts comma-separated values for any enum filter", async () => {
    const { body } = await list("severity=critical,high&status=unresolved");
    expect(body.findings.map((f) => f.severity).sort()).toEqual(["critical", "high", "high"]);

    const statuses = await list("status=new,reopened");
    expect(statuses.body.total).toBe(2);
  });

  it("accepts several repo ids", async () => {
    expect((await list(`repo_id=${ids.api.id}`)).body.total).toBe(3);
    expect((await list(`repo_id=${ids.api.id},${ids.web.id}`)).body.total).toBe(6);
  });

  it("searches rule id, message and file path case-insensitively", async () => {
    const { body } = await list("q=sql");
    expect(body.total).toBe(3); // rule id, message, file path
  });

  it("matches LIKE wildcards literally", async () => {
    expect((await list("q=100%25")).body.total).toBe(1);
    expect((await list("q=%25")).body.total).toBe(1);
    expect((await list("q=_")).body.total).toBe(0);
  });

  it("rejects unknown filter values instead of silently matching nothing", async () => {
    const res = await list("severity=critical,urgent");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown severity: urgent/);
    expect((await list("repo_id=abc")).status).toBe(400);
  });

  it("falls back to defaults for malformed paging", async () => {
    const res = await list("page=abc&page_size=-5");
    expect(res.status).toBe(200);
    expect(res.body.findings).toHaveLength(1);
  });
});

describe("GET /api/repos/:id", () => {
  it("includes the same summary counts as the list", async () => {
    const res = await app.inject({ url: `/api/repos/${ids.api.id}` });
    expect(res.json()).toMatchObject({ fullName: "acme/api", openFindings: 2, criticalOrHigh: 2, scans: [{}] });
  });
});
