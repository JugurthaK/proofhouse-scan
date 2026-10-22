import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { nowIso } from "../db/client.js";
import {
  findings,
  repos,
  scans,
  SCANNERS,
  type Provider,
  type Repo,
  type Scanner,
  type Severity,
} from "../db/schema.js";
import { normalizeSarif, type NormalizedFinding } from "../sarif/normalize.js";
import { parseSarif } from "../sarif/parse.js";
import { parseRepoRef } from "../scm/ref.js";
import { reconcileFindings, type ReconcileResult } from "./reconcile.js";

export interface IngestPayload {
  /** owner/name (GitHub) or host/group/.../project (GitLab). */
  repo: string;
  /** Rejects a repo of the other kind; inferred from `repo` when omitted. */
  provider?: Provider;
  commitSha?: string | null;
  ref?: string | null;
  /** Consumer's workflow run id, stored as scans.workflow_run_id. */
  runId?: number | null;
  correlationId?: string;
  isPrivate?: boolean;
  defaultBranch?: string;
  /** Raw SARIF documents by scanner. */
  sarif: Partial<Record<Scanner, string>>;
}

export interface IngestSummary {
  scanId: number;
  repoId: number;
  scannersIngested: Scanner[];
  scannersFailed: Scanner[];
  counts: ReconcileResult;
  /** New findings introduced by this scan, by severity — powers CI fail_on. */
  newBySeverity: Partial<Record<Severity, number>>;
}

/**
 * Upsert a repos row from payload metadata alone — no GitHub/GitLab API call,
 * so hosted ingest works without any SCM token. (Dispatch mode keeps using
 * upsertRepo in run-scan.ts, which fetches metadata from GitHub.)
 */
export function upsertRepoLocal(db: Db, payload: IngestPayload): Repo {
  const ref = parseRepoRef(payload.repo, payload.provider);

  const existing = db
    .select()
    .from(repos)
    .where(eq(repos.fullName, ref.fullName))
    .get();
  if (existing) {
    const updates: Partial<typeof repos.$inferInsert> = {};
    if (payload.defaultBranch !== undefined) updates.defaultBranch = payload.defaultBranch;
    if (payload.isPrivate !== undefined) updates.isPrivate = payload.isPrivate;
    if (Object.keys(updates).length > 0) {
      return db.update(repos).set(updates).where(eq(repos.id, existing.id)).returning().get();
    }
    return existing;
  }
  return db
    .insert(repos)
    .values({
      provider: ref.provider,
      owner: ref.owner,
      name: ref.name,
      fullName: ref.fullName,
      defaultBranch: payload.defaultBranch ?? null,
      isPrivate: payload.isPrivate ?? false,
      createdAt: nowIso(),
    })
    .returning()
    .get();
}

/**
 * Ingest SARIF pushed by the composite action (or any client): normalize,
 * reconcile against existing findings, record a completed 'action' scan.
 * Throws if no scanner's SARIF could be parsed.
 */
export function ingestSarifScan(db: Db, payload: IngestPayload): IngestSummary {
  const repo = upsertRepoLocal(db, payload);

  const allFindings: NormalizedFinding[] = [];
  const ingested: Scanner[] = [];
  const failed: Scanner[] = [];
  const parseErrors: string[] = [];
  for (const scanner of SCANNERS) {
    const raw = payload.sarif[scanner];
    if (raw === undefined) continue;
    try {
      allFindings.push(...normalizeSarif(parseSarif(raw), scanner));
      ingested.push(scanner);
    } catch (err) {
      failed.push(scanner);
      parseErrors.push(`${scanner}: ${String(err)}`);
    }
  }
  if (ingested.length === 0) {
    throw new Error(
      `No SARIF could be ingested${parseErrors.length ? ` (${parseErrors.join("; ")})` : ""}`,
    );
  }

  const scan = db
    .insert(scans)
    .values({
      repoId: repo.id,
      correlationId: payload.correlationId ?? randomUUID(),
      workflowRunId: payload.runId ?? null,
      commitSha: payload.commitSha ?? null,
      ref: payload.ref ?? null,
      source: "action",
      status: "running",
      startedAt: nowIso(),
    })
    .returning()
    .get();

  const counts = reconcileFindings(db, repo.id, scan.id, allFindings);

  db.update(scans)
    .set({
      status: "completed",
      finishedAt: nowIso(),
      error: failed.length > 0 ? `Failed to parse SARIF: ${parseErrors.join("; ")}` : null,
    })
    .where(eq(scans.id, scan.id))
    .run();
  db.update(repos).set({ lastScannedAt: nowIso() }).where(eq(repos.id, repo.id)).run();

  const newRows = db
    .select({ severity: findings.severity, count: sql<number>`count(*)` })
    .from(findings)
    .where(
      and(
        eq(findings.repoId, repo.id),
        eq(findings.status, "new"),
        eq(findings.lastSeenScanId, scan.id),
      ),
    )
    .groupBy(findings.severity)
    .all();
  const newBySeverity: Partial<Record<Severity, number>> = {};
  for (const row of newRows) newBySeverity[row.severity] = row.count;

  return {
    scanId: scan.id,
    repoId: repo.id,
    scannersIngested: ingested,
    scannersFailed: failed,
    counts,
    newBySeverity,
  };
}
