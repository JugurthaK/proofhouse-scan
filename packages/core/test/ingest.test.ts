import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db/client.js";
import { findings, scans } from "../src/db/schema.js";
import { ingestSarifScan } from "../src/scan/ingest.js";
import { gitleaksSarif, opengrepSarif, trivySarif } from "./fixtures.js";

function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), "proofhouse-scan-ingest-")), "t.db");
}

describe("ingestSarifScan", () => {
  it("ingests a multi-scanner payload and reconciles across ingests", () => {
    const db = openDb(tempDbPath());

    const first = ingestSarifScan(db, {
      repo: "acme/demo",
      commitSha: "aaa111",
      ref: "main",
      runId: 123,
      sarif: { opengrep: opengrepSarif, trivy: trivySarif, gitleaks: gitleaksSarif },
    });
    expect(first.scannersIngested).toEqual(["opengrep", "trivy", "gitleaks"]);
    expect(first.counts.new).toBe(4); // 1 sast + 2 trivy + 1 secret
    expect(first.newBySeverity.high).toBeGreaterThan(0);

    const scanRow = db.select().from(scans).all()[0]!;
    expect(scanRow.source).toBe("action");
    expect(scanRow.status).toBe("completed");
    expect(scanRow.commitSha).toBe("aaa111");
    expect(scanRow.workflowRunId).toBe(123);

    // Second ingest without gitleaks findings: secret resolves, rest stay open.
    const second = ingestSarifScan(db, {
      repo: "acme/demo",
      commitSha: "bbb222",
      sarif: {
        opengrep: opengrepSarif,
        trivy: trivySarif,
        gitleaks: JSON.stringify({ version: "2.1.0", runs: [] }),
      },
    });
    expect(second.counts.new).toBe(0);
    expect(second.counts.open).toBe(3);
    expect(second.counts.resolved).toBe(1);

    const secret = db.select().from(findings).all().find((f) => f.category === "secret")!;
    expect(secret.status).toBe("resolved");
  });

  it("throws when no SARIF parses", () => {
    const db = openDb(tempDbPath());
    expect(() =>
      ingestSarifScan(db, { repo: "acme/demo", sarif: { trivy: "not json" } }),
    ).toThrow(/No SARIF could be ingested/);
    expect(db.select().from(scans).all()).toHaveLength(0);
  });

  it("rejects malformed repo slugs", () => {
    const db = openDb(tempDbPath());
    expect(() =>
      ingestSarifScan(db, { repo: "not-a-slug", sarif: { opengrep: opengrepSarif } }),
    ).toThrow(/expected owner\/repo/);
  });

  it("migrates pre-source databases via ensureColumn", () => {
    // Simulate a v1 database whose scans table lacks source/ref.
    const dbPath = tempDbPath();
    const raw = new Database(dbPath);
    raw.exec(`
      CREATE TABLE repos (id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
        name TEXT NOT NULL, full_name TEXT NOT NULL UNIQUE, default_branch TEXT,
        is_private INTEGER NOT NULL DEFAULT 0, last_scanned_at TEXT, created_at TEXT NOT NULL);
      CREATE TABLE scans (id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_id INTEGER NOT NULL REFERENCES repos(id), workflow_run_id INTEGER,
        correlation_id TEXT NOT NULL, commit_sha TEXT,
        status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, error TEXT,
        counts_new INTEGER, counts_resolved INTEGER, counts_open INTEGER);
    `);
    raw.close();

    const db = openDb(dbPath);
    const cols = (db.$client.pragma("table_info(scans)") as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toContain("source");
    expect(cols).toContain("ref");
  });
});
