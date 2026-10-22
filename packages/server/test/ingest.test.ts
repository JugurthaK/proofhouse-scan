import { openDb, repos, type Db } from "@proofhouse-scan/core";
import type { FastifyInstance } from "fastify";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";

// Any of these would put the API behind auth; these tests want it open.
const AUTH_ENV = [
  "PROOFHOUSE_SCAN_API_TOKEN",
  "PROOFHOUSE_SCAN_INGEST_TOKEN",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "PROOFHOUSE_SCAN_ALLOWED_USERS",
  "PROOFHOUSE_SCAN_ALLOWED_ORGS",
];

const EMPTY_SARIF = JSON.stringify({ version: "2.1.0", runs: [] });

let savedEnv: Record<string, string | undefined>;
let db: Db;
let app: FastifyInstance;

beforeEach(() => {
  savedEnv = Object.fromEntries(AUTH_ENV.map((k) => [k, process.env[k]]));
  for (const key of AUTH_ENV) delete process.env[key];
  db = openDb(join(mkdtempSync(join(tmpdir(), "proofhouse-scan-ingest-route-")), "t.db"));
  app = buildApp(db);
});

afterEach(async () => {
  await app.close();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ingest = (payload: Record<string, unknown>) =>
  app.inject({ method: "POST", url: "/api/ingest", payload });

describe("POST /api/ingest", () => {
  it("accepts a GitLab payload with a nested, host-prefixed path", async () => {
    const res = await ingest({
      provider: "gitlab",
      repo: "gitlab.com/acme/platform/api",
      commit_sha: "abc123",
      run_id: 2_412_345_678,
      is_private: true,
      sarif: { opengrep: EMPTY_SARIF },
    });
    expect(res.statusCode).toBe(200);
    expect(db.select().from(repos).get()).toMatchObject({
      provider: "gitlab",
      fullName: "gitlab.com/acme/platform/api",
      owner: "acme/platform",
      name: "api",
      isPrivate: true,
    });
    // The UI builds GitLab links from provider + fullName.
    const list = (await app.inject({ url: "/api/repos" })).json() as { provider: string; fullName: string }[];
    expect(list).toMatchObject([{ provider: "gitlab", fullName: "gitlab.com/acme/platform/api" }]);
  });

  it("keeps accepting GitHub payloads that omit provider", async () => {
    const res = await ingest({ repo: "acme/api", sarif: { trivy: EMPTY_SARIF } });
    expect(res.statusCode).toBe(200);
    expect(db.select().from(repos).get()?.provider).toBe("github");
  });

  it("rejects unknown providers and repos that don't match the provider", async () => {
    const bitbucket = await ingest({ provider: "bitbucket", repo: "acme/api", sarif: { trivy: EMPTY_SARIF } });
    expect(bitbucket.statusCode).toBe(400);

    const hostless = await ingest({ provider: "gitlab", repo: "acme/api", sarif: { trivy: EMPTY_SARIF } });
    expect(hostless.statusCode).toBe(400);
    expect(hostless.json().error).toMatch(/need their host/);

    const missing = await ingest({ sarif: { trivy: EMPTY_SARIF } });
    expect(missing.statusCode).toBe(400);
  });
});
