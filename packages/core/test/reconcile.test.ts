import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { nowIso, openDb, type Db } from "../src/db/client.js";
import { findings, repos, scans } from "../src/db/schema.js";
import type { NormalizedFinding } from "../src/sarif/normalize.js";
import { reconcileFindings } from "../src/scan/reconcile.js";

function makeFinding(overrides: Partial<NormalizedFinding> = {}): NormalizedFinding {
  return {
    scanner: "opengrep",
    category: "sast",
    fingerprint: "fp-default",
    ruleId: "rule-1",
    message: "msg",
    severity: "high",
    filePath: "src/a.js",
    startLine: 1,
    endLine: 1,
    snippet: "bad()",
    raw: { message: { text: "msg" } },
    ...overrides,
  };
}

describe("reconcileFindings", () => {
  let db: Db;
  let repoId: number;

  beforeEach(() => {
    db = openDb(join(mkdtempSync(join(tmpdir(), "proofhouse-scan-test-")), "t.db"));
    repoId = db
      .insert(repos)
      .values({ owner: "o", name: "r", fullName: "o/r", createdAt: nowIso() })
      .returning()
      .get().id;
  });

  function newScan(): number {
    return db
      .insert(scans)
      .values({
        repoId,
        correlationId: "c",
        status: "running",
        startedAt: nowIso(),
      })
      .returning()
      .get().id;
  }

  it("marks first-seen findings as new, then open, then resolved", () => {
    const scan1 = newScan();
    const r1 = reconcileFindings(db, repoId, scan1, [
      makeFinding({ fingerprint: "fp-a" }),
      makeFinding({ fingerprint: "fp-b" }),
    ]);
    expect(r1).toMatchObject({ new: 2, open: 0, resolved: 0, totalOpen: 2 });

    const scan2 = newScan();
    const r2 = reconcileFindings(db, repoId, scan2, [
      makeFinding({ fingerprint: "fp-a" }),
    ]);
    expect(r2).toMatchObject({ new: 0, open: 1, resolved: 1, totalOpen: 1 });

    const rows = db.select().from(findings).all();
    const byFp = Object.fromEntries(rows.map((r) => [r.fingerprint, r]));
    expect(byFp["fp-a"]!.status).toBe("open");
    expect(byFp["fp-b"]!.status).toBe("resolved");
    expect(byFp["fp-b"]!.resolvedAt).toBeTruthy();
  });

  it("reopens resolved findings that reappear", () => {
    const scan1 = newScan();
    reconcileFindings(db, repoId, scan1, [makeFinding({ fingerprint: "fp-a" })]);
    const scan2 = newScan();
    reconcileFindings(db, repoId, scan2, []);
    const scan3 = newScan();
    const r3 = reconcileFindings(db, repoId, scan3, [
      makeFinding({ fingerprint: "fp-a" }),
    ]);
    expect(r3.reopened).toBe(1);
    expect(db.select().from(findings).all()[0]!.status).toBe("reopened");
  });

  it("preserves finding id (and thus qualifications) across scans", () => {
    const scan1 = newScan();
    reconcileFindings(db, repoId, scan1, [makeFinding({ fingerprint: "fp-a" })]);
    const idBefore = db.select().from(findings).all()[0]!.id;
    const scan2 = newScan();
    reconcileFindings(db, repoId, scan2, [
      makeFinding({ fingerprint: "fp-a", startLine: 50, endLine: 50 }),
    ]);
    const after = db.select().from(findings).all();
    expect(after).toHaveLength(1);
    expect(after[0]!.id).toBe(idBefore);
    expect(after[0]!.startLine).toBe(50);
  });

  it("updates scan counts", () => {
    const scanId = newScan();
    reconcileFindings(db, repoId, scanId, [makeFinding({ fingerprint: "fp-a" })]);
    const scanRow = db.select().from(scans).all().find((s) => s.id === scanId)!;
    expect(scanRow.countsNew).toBe(1);
    expect(scanRow.countsOpen).toBe(1);
  });
});
